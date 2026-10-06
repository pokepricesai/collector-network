import 'server-only';

// Centralised Collector Network job registry.
//
// Both the scheduled cron routes under /api/sync/* AND the manual
// /admin/jobs page invoke jobs through here. Benefits:
//
//   • Fixed allowlist. Nothing outside this module can be executed
//     as a "job" from the admin UI; no arbitrary route invocation.
//   • Every run — manual or scheduled — writes to network_job_runs
//     through the SAME wrapper, so the operator view is consistent.
//   • CRON_SECRET never leaves server code. The admin page relies on
//     requireAdmin() and this module uses the service-role Supabase
//     client server-side only.
//   • Job metadata (name, description, est. cost, requires-confirm)
//     lives next to the executor.
//
// Convention: `slug` = programmatic identifier (`sitemaps.check`),
// `jobName` = value we write into network_job_runs.job_name so that
// scheduled and manual runs appear in the same operator view.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleSupabase } from '../admin/service-role';
import { syncAllGsc, syncAllGa4 } from '../google/sync';
import { generateOpportunities } from '../opportunities/engine';
import { runSitemapCheck, recordSitemapSnapshot, type SiteDescriptor } from '../sitemaps/engine';
import { buildInspectionQueue, processInspectionQueue } from '../inspection/engine';
import { generateInternalLinkOpportunities } from '../internal-links/engine';
import { generatePageOpportunities } from '../page-opportunities/engine';
import { runPokepricesBqAnalysis, bigqueryDiagnostic } from '../bigquery/analysis';
import { estimateBqCostUsd, formatBqBytes } from '../google/bigquery';
import { buildBrief } from '../brief/engine';
import { generateIdeasForSite } from '../content/ideas';
import { ingestImpactEpn, type IngestResult } from '../impact/ingest';
import { ingestImpactInvoices, type InvoiceIngestResult } from '../impact/invoice-ingest';

// The five sites are hard-coded here to keep the allowlist static.
// Resolution to real UUIDs happens inside each run().
const SITE_SLUGS = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'] as const;
type SiteSlug = typeof SITE_SLUGS[number];

async function loadSiteDescriptor(sb: SupabaseClient, slug: SiteSlug): Promise<SiteDescriptor> {
  const { data, error } = await sb.from('network_sites')
    .select('id, slug, canonical_url').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`[jobs] load site ${slug}: ${error.message}`);
  if (!data) throw new Error(`[jobs] site ${slug} not found`);
  return { id: data.id as string, slug: data.slug as string, canonicalUrl: data.canonical_url as string };
}

/** Shared per-site sitemap executor. Writes one job_run per invocation
 *  with site_id set, keeping manual + cron entries uniform. Returns
 *  metrics for the outer wrapper (there isn't one — wrapsOuter=false). */
async function runSitemapForOneSite(sb: SupabaseClient, slug: SiteSlug): Promise<{
  rowsInserted: number;
  rowsExamined: number;
  rowsRejected: number;
  summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
}> {
  const site = await loadSiteDescriptor(sb, slug);
  const jobStart = Date.now();
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'sitemap.check',
    p_job_type: 'sync',
    p_site_id: site.id,
    p_metadata: { site: slug, trigger: 'per-site' } as unknown as Record<string, unknown>,
  });
  try {
    const result = await runSitemapCheck(site);
    const { snapshotId } = await recordSitemapSnapshot(sb, site, result);
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: result.issues.some((i) => i.severity === 'error') ? 'warning' : 'success',
      p_rows_examined: result.submittedCount,
      p_rows_inserted: 1,
      p_rows_updated: 0,
      p_rows_rejected: result.issues.filter((i) => i.severity === 'error').length,
      p_error_summary: result.errorSummary,
      p_metadata: {
        snapshot_id: snapshotId,
        shards: result.shardCount,
        submitted: result.submittedCount,
        valid_sampled: result.validSampled,
        issues: result.issues.length,
        duration_ms: result.durationMs,
        budget_exceeded: result.budgetExceeded,
      } as unknown as Record<string, unknown>,
    });
    return {
      rowsInserted: 1,
      rowsExamined: result.submittedCount,
      rowsRejected: result.issues.filter((i) => i.severity === 'error').length,
      summary: { site: slug, submitted: result.submittedCount, valid: result.validSampled, issues: result.issues.length, shards: result.shardCount, duration_ms: result.durationMs },
      metadata: { site: slug, snapshot_id: snapshotId, duration_ms: result.durationMs, budget_exceeded: result.budgetExceeded },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sb.rpc('network_fail_job_run', {
      p_id: jobId,
      p_error_summary: msg.slice(0, 500),
      p_metadata: { site: slug, duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
    });
    throw err;
  }
}

/** Per-site URL inspection runner. One job_run per invocation, 50-URL
 *  cap per site, quota-aware. Each inspection HTTP call is bounded.
 *  Comfortably well under Vercel's 300s cap even at 50 × 3s = 150s. */
async function runInspectionForOneSite(sb: SupabaseClient, slug: SiteSlug): Promise<{
  rowsInserted: number;
  rowsExamined: number;
  rowsRejected: number;
  summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
}> {
  const site = await loadSiteDescriptor(sb, slug);
  // Need the GSC property URL for the Inspection API call.
  const { data: prop, error: propErr } = await sb
    .from('network_google_properties')
    .select('property_id')
    .eq('site_id', site.id).eq('kind', 'gsc').eq('status', 'active')
    .maybeSingle();
  if (propErr) throw new Error(`[inspection/${slug}] load property: ${propErr.message}`);
  if (!prop) throw new Error(`[inspection/${slug}] no active GSC property`);
  const propertyId = (prop as { property_id: string }).property_id;

  const jobStart = Date.now();
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'inspection.cycle',
    p_job_type: 'sync',
    p_site_id: site.id,
    p_metadata: { site: slug, property_id: propertyId, trigger: 'per-site' } as unknown as Record<string, unknown>,
  });
  try {
    const { enqueued } = await buildInspectionQueue(sb, site.id);
    // 25 URLs/site: at Google's typical 2-5s/call that's 50-125s per
    // invocation — comfortably under the 300s Vercel cap even with
    // overhead. Operators can run twice to work through the queue.
    const r = await processInspectionQueue(sb, site.id, propertyId, 25);
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: r.errors.length === 0 && !r.quotaExceeded ? 'success' : 'warning',
      p_rows_examined: r.processed,
      p_rows_inserted: r.inspected,
      p_rows_updated: 0,
      p_rows_rejected: r.errors.length,
      p_error_summary: r.quotaExceeded ? 'quota exceeded' : null,
      p_metadata: {
        site: slug, enqueued,
        duration_ms: Date.now() - jobStart,
        quota_exceeded: r.quotaExceeded,
        first_error: r.errors[0]?.error ?? null,
      } as unknown as Record<string, unknown>,
    });
    return {
      rowsInserted: r.inspected,
      rowsExamined: r.processed,
      rowsRejected: r.errors.length,
      summary: { site: slug, enqueued, processed: r.processed, inspected: r.inspected, quota_exceeded: r.quotaExceeded, errors: r.errors.length },
      metadata: { site: slug, enqueued, inspected: r.inspected, errors: r.errors.length, duration_ms: Date.now() - jobStart },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sb.rpc('network_fail_job_run', {
      p_id: jobId,
      p_error_summary: msg.slice(0, 500),
      p_metadata: { site: slug, duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
    });
    throw err;
  }
}

/** Per-site intelligence runner. One job_run per invocation; the
 *  underlying engines now do bulk upserts so even PokePrices (~900
 *  opportunities) completes in <5s. */
async function runIntelForOneSite(sb: SupabaseClient, slug: SiteSlug): Promise<{
  rowsInserted: number;
  rowsUpdated: number;
  summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
}> {
  const site = await loadSiteDescriptor(sb, slug);
  const jobStart = Date.now();
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'intel.links_and_pages',
    p_job_type: 'analysis',
    p_site_id: site.id,
    p_metadata: { site: slug, trigger: 'per-site' } as unknown as Record<string, unknown>,
  });
  try {
    const today = new Date();
    const [internal, pages] = await Promise.all([
      generateInternalLinkOpportunities(sb, site.id, today),
      generatePageOpportunities(sb, slug, site.id, today),
    ]);
    const inserted = internal.generated + pages.generated;
    const updated  = internal.updated   + pages.updated;
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: 'success',
      p_rows_examined: 0,
      p_rows_inserted: inserted,
      p_rows_updated: updated,
      p_rows_rejected: 0,
      p_error_summary: null,
      p_metadata: {
        site: slug, internal, pages,
        duration_ms: Date.now() - jobStart,
      } as unknown as Record<string, unknown>,
    });
    return {
      rowsInserted: inserted, rowsUpdated: updated,
      summary: { site: slug, internal, pages, duration_ms: Date.now() - jobStart },
      metadata: { site: slug, internal, pages, duration_ms: Date.now() - jobStart },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sb.rpc('network_fail_job_run', {
      p_id: jobId,
      p_error_summary: msg.slice(0, 500),
      p_metadata: { site: slug, duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
    });
    throw err;
  }
}

export interface JobRunResult {
  ok: boolean;
  slug: string;
  jobName: string;
  jobRunId: string | null;
  durationMs: number;
  summary: Record<string, unknown>;
  rowsInserted: number;
  rowsUpdated: number;
  rowsExamined: number;
  rowsRejected: number;
  errorSummary: string | null;
  metadata: Record<string, unknown>;
}

export interface JobDefinition {
  slug: string;
  jobName: string;
  group: 'ingest' | 'analysis' | 'ops';
  label: string;
  description: string;
  requiresConfirmation?: boolean;
  // Null = don't wrap in an outer job_run (inner functions manage
  // their own entries, so wrapping would double-count).
  wrapsOuter: boolean;
  // The executor. Receives a service-role Supabase client and
  // returns the metrics we care about recording. The wrapper
  // handles network_job_runs.
  run: (sb: SupabaseClient) => Promise<{
    rowsInserted?: number;
    rowsUpdated?: number;
    rowsExamined?: number;
    rowsRejected?: number;
    metadata?: Record<string, unknown>;
    summary: Record<string, unknown>;
  }>;
}

// Lift an IngestResult into the shape runJobBySlug expects.
function summariseImpactIngest(r: IngestResult): {
  rowsInserted: number;
  rowsUpdated: number;
  rowsExamined: number;
  rowsRejected: number;
  metadata: Record<string, unknown>;
  summary: Record<string, unknown>;
} {
  // Throw to flip the outer wrapper into fail-state when the ingest
  // either skipped (missing creds) or hit a fatal error inside. The
  // wrapper will record the exception in network_fail_job_run.
  if (r.skipped_reason) throw new Error(`ingest skipped: ${r.skipped_reason}`);
  if (r.errors.length > 0) throw new Error(r.errors[0] ?? 'ingest errors');
  return {
    rowsInserted: r.actions_inserted,
    rowsUpdated:  r.actions_updated,
    rowsExamined: r.actions_seen,
    rowsRejected: r.actions_rejected_unknown_shared_id + r.actions_rejected_missing_critical_fields,
    metadata: {
      status_history_rows_inserted: r.status_history_rows_inserted,
      rejected_unknown_shared_id: r.actions_rejected_unknown_shared_id,
      rejected_missing_fields: r.actions_rejected_missing_critical_fields,
      by_slug: r.by_slug,
      window_days: r.window_days,
      total_days: r.total_days,
      windows_failed: r.windows.filter((w) => w.status === 'failed').length,
      windows_partial: r.windows.filter((w) => w.status === 'partial').length,
      action_updates_fetched: r.action_updates_fetched,
      warnings: r.warnings.slice(0, 5),
    },
    summary: {
      actions_seen: r.actions_seen,
      actions_upserted: r.actions_upserted,
      actions_inserted: r.actions_inserted,
      actions_updated: r.actions_updated,
      by_slug: r.by_slug,
    },
  };
}

function summariseInvoiceIngest(r: InvoiceIngestResult): {
  rowsInserted: number;
  rowsUpdated: number;
  rowsExamined: number;
  rowsRejected: number;
  metadata: Record<string, unknown>;
  summary: Record<string, unknown>;
} {
  if (r.skipped_reason) throw new Error(`invoice ingest skipped: ${r.skipped_reason}`);
  if (r.errors.length > 0) throw new Error(r.errors[0] ?? 'invoice ingest errors');
  return {
    rowsInserted: r.invoices_inserted,
    rowsUpdated:  r.invoices_updated,
    rowsExamined: r.invoices_seen,
    rowsRejected: r.invoices_rejected,
    metadata: {
      pages_fetched: r.pages_fetched,
      totals_by_currency: r.totals_by_currency,
      earliest_invoice_date: r.earliest_invoice_date,
      latest_invoice_date: r.latest_invoice_date,
      warnings: r.warnings.slice(0, 5),
    },
    summary: {
      invoices_seen: r.invoices_seen,
      invoices_upserted: r.invoices_upserted,
      invoices_inserted: r.invoices_inserted,
      totals_by_currency: r.totals_by_currency,
    },
  };
}

// --- JOB DEFINITIONS -----------------------------------------------
export const JOBS: Record<string, JobDefinition> = {
  'gsc.sync': {
    slug: 'gsc.sync',
    jobName: 'gsc.incremental',
    group: 'ingest',
    label: 'GSC sync (incremental)',
    description: 'Sliding-window re-fetch of GSC metrics across all five sites. Creates one job_run per property. ~30s typical.',
    wrapsOuter: false,
    run: async (sb) => {
      const r = await syncAllGsc(sb, new Date());
      return {
        rowsInserted: r.totals.site_daily + r.totals.url_daily + r.totals.query_daily + r.totals.url_query_daily,
        summary: r as unknown as Record<string, unknown>,
      };
    },
  },
  'ga4.sync': {
    slug: 'ga4.sync',
    jobName: 'ga4.incremental',
    group: 'ingest',
    label: 'GA4 sync (incremental)',
    description: 'Sliding-window re-fetch of GA4 daily metrics across all five sites.',
    wrapsOuter: false,
    run: async (sb) => {
      const r = await syncAllGa4(sb, new Date());
      return { rowsInserted: r.totals.rows, summary: r as unknown as Record<string, unknown> };
    },
  },
  'opportunities.generate': {
    slug: 'opportunities.generate',
    jobName: 'opportunities.generate',
    group: 'analysis',
    label: 'SEO opportunities',
    description: 'Deterministic SEO opportunity rules over 28d GSC data. Should run after a GSC sync.',
    wrapsOuter: true,
    run: async (sb) => {
      const r = await generateOpportunities(sb, new Date());
      return {
        rowsInserted: r.generated,
        rowsUpdated: r.updated,
        summary: r as unknown as Record<string, unknown>,
      };
    },
  },
  'sitemaps.pokemon': {
    slug: 'sitemaps.pokemon', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · PokePrices',
    description: 'Checks PokePrices sitemap root + shards + bounded HEAD probes. ~60s budget. Writes one network_sitemap_snapshots row.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'pokemon'),
  },
  'sitemaps.mtg': {
    slug: 'sitemaps.mtg', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · MTGPrices',
    description: 'Checks MTGPrices sitemap root + shards + bounded HEAD probes.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'mtg'),
  },
  'sitemaps.ygo': {
    slug: 'sitemaps.ygo', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · YGOPrices',
    description: 'Checks YGOPrices sitemap root + shards + bounded HEAD probes.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'ygo'),
  },
  'sitemaps.onepiece': {
    slug: 'sitemaps.onepiece', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · OnePiecePrices',
    description: 'Checks OnePiecePrices sitemap root + shards + bounded HEAD probes.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'onepiece'),
  },
  'sitemaps.lorcana': {
    slug: 'sitemaps.lorcana', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · LorcanaPrices',
    description: 'Checks LorcanaPrices sitemap root + shards + bounded HEAD probes.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'lorcana'),
  },
  // --- URL inspection (per site) --------------------------------
  'inspection.pokemon':  { slug: 'inspection.pokemon',  jobName: 'inspection.cycle', group: 'analysis', label: 'URL inspection · PokePrices',     description: 'Inspects up to 50 priority PokePrices URLs via GSC URL Inspection API. Quota-aware. ~1–3min typical.',     wrapsOuter: false, run: async (sb) => runInspectionForOneSite(sb, 'pokemon') },
  'inspection.mtg':      { slug: 'inspection.mtg',      jobName: 'inspection.cycle', group: 'analysis', label: 'URL inspection · MTGPrices',      description: 'Inspects up to 50 priority MTGPrices URLs via GSC URL Inspection API.',      wrapsOuter: false, run: async (sb) => runInspectionForOneSite(sb, 'mtg') },
  'inspection.ygo':      { slug: 'inspection.ygo',      jobName: 'inspection.cycle', group: 'analysis', label: 'URL inspection · YGOPrices',      description: 'Inspects up to 50 priority YGOPrices URLs via GSC URL Inspection API.',      wrapsOuter: false, run: async (sb) => runInspectionForOneSite(sb, 'ygo') },
  'inspection.onepiece': { slug: 'inspection.onepiece', jobName: 'inspection.cycle', group: 'analysis', label: 'URL inspection · OnePiecePrices', description: 'Inspects up to 50 priority OnePiecePrices URLs via GSC URL Inspection API.', wrapsOuter: false, run: async (sb) => runInspectionForOneSite(sb, 'onepiece') },
  'inspection.lorcana':  { slug: 'inspection.lorcana',  jobName: 'inspection.cycle', group: 'analysis', label: 'URL inspection · LorcanaPrices',  description: 'Inspects up to 50 priority LorcanaPrices URLs via GSC URL Inspection API.',  wrapsOuter: false, run: async (sb) => runInspectionForOneSite(sb, 'lorcana') },

  // --- Content idea + SEO-task routing (per site; deterministic) -
  //
  // Each site's job runs TWO engines back-to-back under one job_run:
  //  1. routing: Phase 2 opportunities + cannibalisation + entity-page
  //     content gaps → network_tasks (seo_rewrite / seo_improve /
  //     seo_refresh / consolidation / internal_link_reinforce).
  //  2. ideas: new_query opportunities + hub-ranking content gaps →
  //     network_content_ideas (true editorial candidates).
  //
  // This replaces the earlier design that put on-page SEO signals
  // into the content pipeline — those belong in /admin/tasks.
  'ideas.pokemon':  { slug: 'ideas.pokemon',  jobName: 'content.ideas', group: 'analysis', label: 'SEO routing + content ideas · PokePrices',     description: 'Routes Phase 2 opportunities + cannibalisation to network_tasks; emits content ideas only for new-query opportunities and hub-ranking content gaps. Deterministic — no AI.',    wrapsOuter: true, run: async (sb) => { const s = await loadSiteDescriptor(sb, 'pokemon'); const r = await generateIdeasForSite(sb, s.id, 'pokemon'); return { rowsInserted: r.generated, rowsUpdated: r.refreshed, rowsRejected: r.dismissed_stale, summary: r as unknown as Record<string, unknown>, metadata: { site: 'pokemon', ...r } }; } },
  'ideas.mtg':      { slug: 'ideas.mtg',      jobName: 'content.ideas', group: 'analysis', label: 'SEO routing + content ideas · MTGPrices',      description: 'Same as PokePrices variant, scoped to MTGPrices.',      wrapsOuter: true, run: async (sb) => { const s = await loadSiteDescriptor(sb, 'mtg'); const r = await generateIdeasForSite(sb, s.id, 'mtg'); return { rowsInserted: r.generated, rowsUpdated: r.refreshed, rowsRejected: r.dismissed_stale, summary: r as unknown as Record<string, unknown>, metadata: { site: 'mtg', ...r } }; } },
  'ideas.ygo':      { slug: 'ideas.ygo',      jobName: 'content.ideas', group: 'analysis', label: 'SEO routing + content ideas · YGOPrices',      description: 'Same as PokePrices variant, scoped to YGOPrices.',      wrapsOuter: true, run: async (sb) => { const s = await loadSiteDescriptor(sb, 'ygo'); const r = await generateIdeasForSite(sb, s.id, 'ygo'); return { rowsInserted: r.generated, rowsUpdated: r.refreshed, rowsRejected: r.dismissed_stale, summary: r as unknown as Record<string, unknown>, metadata: { site: 'ygo', ...r } }; } },
  'ideas.onepiece': { slug: 'ideas.onepiece', jobName: 'content.ideas', group: 'analysis', label: 'SEO routing + content ideas · OnePiecePrices', description: 'Same as PokePrices variant, scoped to OnePiecePrices.', wrapsOuter: true, run: async (sb) => { const s = await loadSiteDescriptor(sb, 'onepiece'); const r = await generateIdeasForSite(sb, s.id, 'onepiece'); return { rowsInserted: r.generated, rowsUpdated: r.refreshed, rowsRejected: r.dismissed_stale, summary: r as unknown as Record<string, unknown>, metadata: { site: 'onepiece', ...r } }; } },
  'ideas.lorcana':  { slug: 'ideas.lorcana',  jobName: 'content.ideas', group: 'analysis', label: 'SEO routing + content ideas · LorcanaPrices',  description: 'Same as PokePrices variant, scoped to LorcanaPrices.',  wrapsOuter: true, run: async (sb) => { const s = await loadSiteDescriptor(sb, 'lorcana'); const r = await generateIdeasForSite(sb, s.id, 'lorcana'); return { rowsInserted: r.generated, rowsUpdated: r.refreshed, rowsRejected: r.dismissed_stale, summary: r as unknown as Record<string, unknown>, metadata: { site: 'lorcana', ...r } }; } },

  // --- Intel (internal links + page opportunities, per site) ----
  'intel.pokemon':  { slug: 'intel.pokemon',  jobName: 'intel.links_and_pages', group: 'analysis', label: 'Intel · PokePrices',     description: 'Internal-link + page-opportunity engines for PokePrices. Bulk-upserts into Supabase; <5s typical.',    wrapsOuter: false, run: async (sb) => runIntelForOneSite(sb, 'pokemon') },
  'intel.mtg':      { slug: 'intel.mtg',      jobName: 'intel.links_and_pages', group: 'analysis', label: 'Intel · MTGPrices',      description: 'Internal-link + page-opportunity engines for MTGPrices.',      wrapsOuter: false, run: async (sb) => runIntelForOneSite(sb, 'mtg') },
  'intel.ygo':      { slug: 'intel.ygo',      jobName: 'intel.links_and_pages', group: 'analysis', label: 'Intel · YGOPrices',      description: 'Internal-link + page-opportunity engines for YGOPrices.',      wrapsOuter: false, run: async (sb) => runIntelForOneSite(sb, 'ygo') },
  'intel.onepiece': { slug: 'intel.onepiece', jobName: 'intel.links_and_pages', group: 'analysis', label: 'Intel · OnePiecePrices', description: 'Internal-link + page-opportunity engines for OnePiecePrices.', wrapsOuter: false, run: async (sb) => runIntelForOneSite(sb, 'onepiece') },
  'intel.lorcana':  { slug: 'intel.lorcana',  jobName: 'intel.links_and_pages', group: 'analysis', label: 'Intel · LorcanaPrices',  description: 'Internal-link + page-opportunity engines for LorcanaPrices.',  wrapsOuter: false, run: async (sb) => runIntelForOneSite(sb, 'lorcana') },
  'bq.pokeprices_analysis': {
    slug: 'bq.pokeprices_analysis',
    jobName: 'bq.pokeprices_analysis',
    group: 'analysis',
    label: 'BigQuery deep SEO analysis',
    description: 'Runs cannibalisation + content-gap queries against pokeprices-seo. Scans ~tens of MB of GSC bulk export data. Costs are tracked.',
    requiresConfirmation: true,
    wrapsOuter: true,
    run: async (sb) => {
      const { data: pokemon } = await sb.from('network_sites').select('id').eq('slug', 'pokemon').maybeSingle();
      if (!pokemon) throw new Error('pokemon site not found in network_sites');
      const r = await runPokepricesBqAnalysis(sb, (pokemon as { id: string }).id);
      const estCost = estimateBqCostUsd(r.bytesBilled);
      // Flip the pokeprices BQ integration to connected on first success.
      await sb.from('network_integrations').update({
        status: 'connected',
        last_success_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        error_summary: null,
      }).eq('provider', 'bigquery');
      return {
        rowsInserted: r.cannibalFindings + r.gapFindings,
        summary: {
          queries: r.queries,
          cannibalisation_findings: r.cannibalFindings,
          content_gap_findings: r.gapFindings,
          bytes_processed: r.bytesProcessed,
          bytes_billed: r.bytesBilled,
          estimated_cost_usd: Number(estCost.toFixed(6)),
        },
        metadata: {
          bq_bytes_processed: r.bytesProcessed,
          bq_bytes_billed: r.bytesBilled,
          bq_bytes_processed_fmt: formatBqBytes(r.bytesProcessed),
          bq_bytes_billed_fmt: formatBqBytes(r.bytesBilled),
          bq_est_cost_usd: Number(estCost.toFixed(6)),
          queries: r.queries,
        },
      };
    },
  },
  'bq.diagnostic': {
    slug: 'bq.diagnostic',
    jobName: 'bq.diagnostic',
    group: 'ops',
    label: 'BigQuery diagnostic probe',
    description: 'Low-cost probe: confirms the WIF chain to BigQuery works and pokeprices-seo datasets are visible. Scans <100MB.',
    wrapsOuter: true,
    run: async (sb) => {
      const r = await bigqueryDiagnostic();
      // Record probe outcome on the integration row.
      await sb.from('network_integrations').update({
        status: r.ok ? 'connected' : 'error',
        last_success_at: r.ok ? new Date().toISOString() : null,
        last_attempt_at: new Date().toISOString(),
        error_summary: r.ok ? null : (r.error ?? 'unknown'),
      }).eq('provider', 'bigquery');
      await sb.from('network_bigquery_readiness').update({
        gsc_export_status: r.ok ? 'connected' : 'error',
        last_checked_at: new Date().toISOString(),
      }).eq('gcp_project_id', 'pokeprices-seo');
      if (!r.ok) throw new Error(r.error ?? 'bigquery diagnostic failed');
      return {
        rowsExamined: r.sampleRows,
        summary: {
          datasets_visible: r.datasetsVisible,
          sample_rows: r.sampleRows,
          bytes_processed: r.bytesProcessed,
          bytes_billed: r.bytesBilled,
        },
        metadata: {
          bq_bytes_processed: r.bytesProcessed,
          bq_bytes_billed: r.bytesBilled,
          bq_bytes_processed_fmt: formatBqBytes(r.bytesProcessed),
          bq_bytes_billed_fmt: formatBqBytes(r.bytesBilled),
          datasets_visible: r.datasetsVisible,
        },
      };
    },
  },
  // --- Impact Media Partner · EPN sync + backfill --------------
  //
  // Both manual-from-admin and the 06:00 UTC cron go through this
  // registry so operator history is consistent. The ingest module is
  // idempotent (idempotency key = impact:epn:<Action.Id>) and
  // self-reports warnings/errors in the result — we lift its fields
  // into the standard job_run metadata.

  'impact.epn.sync_daily': {
    slug: 'impact.epn.sync_daily',
    jobName: 'impact.epn.sync',
    group: 'ingest',
    label: 'Impact EPN daily sync (7-day overlap)',
    description: '/Actions + /ActionUpdates for the last 7 days. SharedId → source routing. Upserts via impact:epn:<Id>. Scheduled 06:00 UTC daily.',
    wrapsOuter: true,
    run: async (sb) => summariseImpactIngest(await ingestImpactEpn(sb, { totalDays: 7, windowDays: 7 })),
  },
  'impact.epn.backfill_365d': {
    slug: 'impact.epn.backfill_365d',
    jobName: 'impact.epn.backfill',
    group: 'ingest',
    label: 'Impact EPN full backfill (365 days)',
    description: 'Re-fetches the entire available Impact Action history. Idempotent. Should rarely be needed after the initial cutover.',
    requiresConfirmation: true,
    wrapsOuter: true,
    run: async (sb) => summariseImpactIngest(await ingestImpactEpn(sb, { totalDays: 365, windowDays: 45 })),
  },
  // ─── Content Autopilot (Checkpoint A: registered but inert) ───
  // These slugs exist so /admin/jobs lists them and so a future
  // scheduled trigger has a stable name. The real executors land
  // in Checkpoint B. If invoked today they log a job_run row and
  // return a `placeholder` summary — no AI, no publication.
  'content.opportunity_refresh': {
    slug: 'content.opportunity_refresh',
    jobName: 'content.opportunity_refresh',
    group: 'analysis',
    label: 'Content opportunity refresh (placeholder)',
    description: 'Rescores known content ideas against freshly-synced GSC + market data. Real executor lands in Checkpoint B.',
    wrapsOuter: true,
    run: async () => ({
      rowsExamined: 0,
      summary: { placeholder: true, note: 'Autopilot foundation only. Real opportunity-scoring executor lands in Checkpoint B.' },
      metadata: { placeholder: true },
    }),
  },
  'content.autopilot': {
    slug: 'content.autopilot',
    jobName: 'content.autopilot',
    group: 'ingest',
    label: 'Content autopilot run (placeholder)',
    description: 'Top-of-funnel orchestrator: pick next opportunity, build evidence pack, reserve budget, generate, QA, publish. Real executor lands in Checkpoint B.',
    requiresConfirmation: true,
    wrapsOuter: true,
    run: async () => ({
      rowsExamined: 0,
      summary: { placeholder: true, note: 'Autopilot foundation only. Real orchestrator lands in Checkpoint B.' },
      metadata: { placeholder: true },
    }),
  },

  'impact.invoices.sync': {
    slug: 'impact.invoices.sync',
    jobName: 'impact.invoices.sync',
    group: 'ingest',
    label: 'Impact invoice sync',
    description: 'Pulls /Invoices and upserts into network_affiliate_invoices. Invoices are settlement data — not counted as transaction revenue.',
    wrapsOuter: true,
    run: async (sb) => summariseInvoiceIngest(await ingestImpactInvoices(sb)),
  },

  'brief.build': {
    slug: 'brief.build',
    jobName: 'brief.build',
    group: 'analysis',
    label: 'Daily operating brief',
    description: 'Composes today\'s brief: network yesterday, notable changes, top 5 actions. Persists to network_daily_briefs so /admin reads instantly.',
    wrapsOuter: true,
    run: async (sb) => {
      const b = await buildBrief(sb, new Date());
      const { error } = await sb
        .from('network_daily_briefs')
        .upsert({ for_date: b.forDate, payload: b as unknown as Record<string, unknown> }, { onConflict: 'for_date' });
      if (error) throw new Error(`upsert brief: ${error.message}`);
      return {
        rowsInserted: 1,
        summary: {
          for_date: b.forDate,
          actions: b.actions.length,
          notable: b.notable.length,
          top_sources: b.countsByCategory,
        },
        metadata: {
          for_date: b.forDate,
          actions: b.actions.length,
          notable: b.notable.length,
        },
      };
    },
  },
};

export function listJobs(): JobDefinition[] {
  return Object.values(JOBS);
}

/** Minutes after which a `running` job_run is considered abandoned. The
 *  Vercel function budget is 5 minutes; any job stuck past that was
 *  killed mid-flight and will never finalise itself. */
export const STALE_RUN_MINUTES = 10;

/**
 * Scan network_job_runs for entries stuck in `running` past the stale
 * threshold and mark them failed. Returns the count recovered. Safe to
 * call on every /admin/jobs page render.
 */
export async function recoverStaleRuns(sb: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  const { data, error } = await sb
    .from('network_job_runs')
    .select('id, job_name, started_at')
    .eq('status', 'running')
    .lt('started_at', cutoff);
  if (error) return 0;
  const rows = (data ?? []) as Array<{ id: string; job_name: string; started_at: string }>;
  let recovered = 0;
  for (const r of rows) {
    const minutes = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60_000);
    await sb.rpc('network_fail_job_run', {
      p_id: r.id,
      p_error_summary: `stale-run recovery: ${minutes} minutes without finalisation. Likely killed by Vercel function budget. Not an application error — operator can re-trigger safely.`,
      p_metadata: { recovered_at: new Date().toISOString(), recovery: 'auto', minutes_running: minutes } as unknown as Record<string, unknown>,
    });
    recovered++;
  }
  return recovered;
}

/** Is a job already running right now? Returns the current running
 *  entry if so, otherwise null. Scoped by job_name since manual +
 *  cron share the same job_name. */
export async function findRunningJob(sb: SupabaseClient, jobName: string): Promise<{ id: string; started_at: string } | null> {
  // Running past STALE_RUN_MINUTES is treated as abandoned, so we
  // only block on fresh running entries.
  const freshCutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  const { data } = await sb
    .from('network_job_runs')
    .select('id, started_at')
    .eq('status', 'running').eq('job_name', jobName)
    .gt('started_at', freshCutoff)
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  return (data as { id: string; started_at: string } | null) ?? null;
}

/**
 * Execute a job by slug using the service-role Supabase client.
 *
 * Writes an outer network_job_runs entry when the JobDefinition
 * doesn't manage its own per-item entries (wrapsOuter=true). For
 * jobs that loop per-site/property, the inner function creates
 * entries already; we skip the outer wrapper to avoid double-count.
 */
export async function runJobBySlug(slug: string): Promise<JobRunResult> {
  const def = JOBS[slug];
  if (!def) throw new Error(`[jobs] unknown job: ${slug}`);
  const sb = createServiceRoleSupabase();

  // Opportunistic stale-run recovery, then duplicate-run check.
  await recoverStaleRuns(sb);
  const alreadyRunning = await findRunningJob(sb, def.jobName);
  if (alreadyRunning) {
    const ageSec = Math.round((Date.now() - new Date(alreadyRunning.started_at).getTime()) / 1000);
    return {
      ok: false, slug, jobName: def.jobName, jobRunId: alreadyRunning.id,
      durationMs: 0, summary: {},
      rowsInserted: 0, rowsUpdated: 0, rowsExamined: 0, rowsRejected: 0,
      errorSummary: `another run of ${def.jobName} is already in progress (${ageSec}s old, id=${alreadyRunning.id.slice(0, 8)})`,
      metadata: { reason: 'duplicate_run_blocked', existing_run_id: alreadyRunning.id },
    };
  }

  const started = Date.now();
  let jobRunId: string | null = null;
  if (def.wrapsOuter) {
    const { data } = await sb.rpc('network_start_job_run', {
      p_job_name: def.jobName,
      p_job_type: def.group === 'ingest' ? 'sync' : def.group === 'analysis' ? 'analysis' : 'maintenance',
      p_site_id: null,
      p_metadata: { trigger: 'admin.jobs' } as unknown as Record<string, unknown>,
    });
    jobRunId = (data as string | null) ?? null;
  }
  try {
    const r = await def.run(sb);
    const durationMs = Date.now() - started;
    const rowsInserted = r.rowsInserted ?? 0;
    const rowsUpdated = r.rowsUpdated ?? 0;
    const rowsExamined = r.rowsExamined ?? 0;
    const rowsRejected = r.rowsRejected ?? 0;
    if (jobRunId) {
      await sb.rpc('network_complete_job_run', {
        p_id: jobRunId,
        p_status: 'success',
        p_rows_examined: rowsExamined,
        p_rows_inserted: rowsInserted,
        p_rows_updated: rowsUpdated,
        p_rows_rejected: rowsRejected,
        p_error_summary: null,
        p_metadata: ({ ...(r.metadata ?? {}), duration_ms: durationMs, trigger: 'admin.jobs' } as unknown) as Record<string, unknown>,
      });
    }
    return {
      ok: true, slug, jobName: def.jobName, jobRunId, durationMs,
      summary: r.summary, rowsInserted, rowsUpdated, rowsExamined, rowsRejected,
      errorSummary: null, metadata: r.metadata ?? {},
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - started;
    if (jobRunId) {
      await sb.rpc('network_fail_job_run', {
        p_id: jobRunId,
        p_error_summary: msg.slice(0, 500),
        p_metadata: { duration_ms: durationMs, trigger: 'admin.jobs' } as unknown as Record<string, unknown>,
      });
    }
    return {
      ok: false, slug, jobName: def.jobName, jobRunId, durationMs,
      summary: {}, rowsInserted: 0, rowsUpdated: 0, rowsExamined: 0, rowsRejected: 0,
      errorSummary: msg, metadata: {},
    };
  }
}
