import 'server-only';

// Publishing orchestrator. All five sites now publish through this
// module. One central Publish action; adapter per target:
//
//   ygo_db / onepiece_db / lorcana_db — DB fallback. The three sites'
//     /insights/[slug] routes read network_articles directly on
//     cache miss. "Publishing" is a status flip + published_at.
//
//   pokeprices_external — direct server-to-server write against the
//     PokePrices Supabase project (its own service-role key, never
//     exposed to the browser). See adapters/pokeprices.ts.
//
//   mtgprices_markdown — GitHub Contents API commit against
//     pokepricesai/mtgprices-web. Vercel git auto-deploy publishes
//     the committed .md file. See adapters/mtgprices.ts.
//
// Pipeline per publish():
//   1. Approval gate.
//   2. Duplicate guard (unique partial index + explicit lookup).
//   3. Adapter write.
//   4. Live-URL verification (poll + content presence check).
//   5. Mark publication 'success', article 'published', idea
//      'published'. If verification fails, record 'failed' and
//      leave the article at 'publishing' for retry.
//   6. Fire IndexNow submission for Bing (non-blocking).
//
// Preview mode still writes the adapter payload into
// network_content_publications with status='preview' so the
// operator can inspect what would be sent without external delivery.

import type { SupabaseClient } from '@supabase/supabase-js';
import { publishToPokePrices } from './adapters/pokeprices';
import { publishToMtgPrices } from './adapters/mtgprices';
import { verifyLiveUrl } from './adapters/verify';
import { htmlToMarkdown, htmlToPokeBlocks } from './adapters/html-convert';
import { readBodyRichHtml } from './sanitise';
import { autoSubmitBingIndexNow } from './indexing';

type PubTarget = 'ygo_db' | 'onepiece_db' | 'lorcana_db' | 'pokeprices_external' | 'mtgprices_markdown';

export interface PublishResult {
  ok: boolean;
  publicationId: string;
  publicationUrl: string | null;
  requiresManualAction: boolean;
  manualPayload?: { kind: 'pokeprices' | 'mtg_markdown'; content: string; filename?: string };
  seoChangeId: string | null;
  verified?: boolean;
  verificationError?: string;
  error?: string;
}

const DB_TARGETS: PubTarget[] = ['ygo_db', 'onepiece_db', 'lorcana_db'];

/**
 * Publish an article. Behaviour depends on `mode`:
 *
 *   mode='preview'  — safe non-public dry run. Creates a
 *                     network_content_publications row with
 *                     status='preview' and the payload the adapter
 *                     would send. Does NOT flip the article to
 *                     'published'. Useful for the acceptance test.
 *
 *   mode='publish'  — actual publish. Requires status='approved'.
 *                     Writes a 'published' or 'manual_pending'
 *                     publication row, flips the article, logs an
 *                     SEO change, and (for DB targets) revalidates
 *                     the public path.
 */
export async function publishArticle(
  sb: SupabaseClient,
  articleId: string,
  adminId: string | null,
  mode: 'preview' | 'publish',
): Promise<PublishResult> {
  const { data: artRow, error: artErr } = await sb
    .from('network_articles')
    .select('id, site_id, title, slug, body, body_format, body_rich, publication_target, status, meta_title, meta_description, summary, primary_query, secondary_queries, author, featured_image_url, network_sites(slug, canonical_url)')
    .eq('id', articleId).maybeSingle();
  if (artErr) throw new Error(`[publish] load article: ${artErr.message}`);
  if (!artRow) throw new Error('article not found');
  const a = artRow as unknown as {
    id: string; site_id: string; title: string; slug: string; body: string; body_format: string; body_rich: unknown;
    publication_target: PubTarget; status: string;
    meta_title: string | null; meta_description: string | null; summary: string | null;
    primary_query: string | null; secondary_queries: string[]; author: string;
    featured_image_url: string | null;
    network_sites: { slug: string; canonical_url: string };
  };

  if (mode === 'publish' && a.status !== 'approved' && a.status !== 'publishing') {
    return {
      ok: false, publicationId: '', publicationUrl: null, requiresManualAction: false, seoChangeId: null,
      error: `article must be status='approved' to publish (current: ${a.status})`,
    };
  }

  // Duplicate guard — a prior 'success' publication for this article
  // means a human must explicitly re-approve a republish by resetting
  // status. Prevents accidental double-publish from the UI, cron, or
  // scheduler all firing on the same row.
  if (mode === 'publish') {
    const { data: prior } = await sb.from('network_content_publications')
      .select('id, publication_url').eq('article_id', a.id).eq('status', 'success').limit(1);
    if ((prior ?? []).length > 0) {
      const existing = (prior as Array<{ id: string; publication_url: string | null }>)[0]!;
      return {
        ok: false, publicationId: existing.id, publicationUrl: existing.publication_url,
        requiresManualAction: false, seoChangeId: null,
        error: `article already published (publication ${existing.id}). Reset status to re-publish.`,
      };
    }
  }

  // Resolve live body: operator-edited body_rich HTML wins; AI
  // markdown is the fallback for articles never opened in the
  // editor.
  const liveHtml = readBodyRichHtml(a.body_rich) ?? '';
  const canonicalBase = a.network_sites.canonical_url.replace(/\/$/, '');
  const publicationUrl = `${canonicalBase}/insights/${a.slug}`;

  let adapterStatus: 'success' | 'manual_pending' | 'preview' | 'failed' = 'preview';
  let payload: Record<string, unknown> = {};
  let manualPayload: PublishResult['manualPayload'];
  let targetRecordId: string | undefined;
  let commitSha: string | undefined;
  let adapterError: string | undefined;

  if (DB_TARGETS.includes(a.publication_target)) {
    // DB adapter — the public /insights/[slug] route on these sites
    // falls through to this article row once status='published'.
    // No external write; the content body is read live from
    // network_articles so operator edits ARE delivered.
    payload = { adapter: 'db_fallback', slug: a.slug, site_slug: a.network_sites.slug, canonical: publicationUrl };
    adapterStatus = mode === 'publish' ? 'success' : 'preview';
  } else if (a.publication_target === 'mtgprices_markdown') {
    if (mode === 'publish') {
      const r = await publishToMtgPrices({
        slug: a.slug,
        title: a.title,
        description: a.meta_description ?? a.summary ?? '',
        bodyHtml: liveHtml,
        bodyMarkdownFallback: a.body ?? null,
        author: a.author,
        category: 'Market',
        publishedAtIso: new Date().toISOString(),
        heroImageUrl: a.featured_image_url,
      });
      if (!r.ok) { adapterError = r.error ?? 'mtg publish failed'; adapterStatus = 'failed'; }
      else { adapterStatus = 'success'; commitSha = r.commitSha; }
    } else {
      // Preview — produce the exact markdown file we WOULD commit.
      const md = (liveHtml.trim().length > 0) ? htmlToMarkdown(liveHtml) : (a.body ?? '');
      manualPayload = { kind: 'mtg_markdown', content: md, filename: `src/content/insights/${a.slug}.md` };
      adapterStatus = 'preview';
    }
    payload = { adapter: 'mtgprices_markdown', filename: `src/content/insights/${a.slug}.md`, canonical: publicationUrl, ...(commitSha ? { commit_sha: commitSha } : {}), ...(adapterError ? { error: adapterError } : {}) };
  } else if (a.publication_target === 'pokeprices_external') {
    if (mode === 'publish') {
      const r = await publishToPokePrices({
        slug: a.slug,
        headline: a.title,
        summary: a.summary,
        bodyHtml: liveHtml,
        bodyMarkdownFallback: a.body ?? null,
        metaTitle: a.meta_title,
        metaDescription: a.meta_description,
        author: a.author,
        publishedAtIso: new Date().toISOString(),
        heroImageUrl: a.featured_image_url,
        primaryQuery: a.primary_query,
      });
      if (!r.ok) { adapterError = r.error ?? 'pokeprices publish failed'; adapterStatus = 'failed'; }
      else { adapterStatus = 'success'; targetRecordId = r.targetRecordId; }
    } else {
      // Preview — show the exact block JSON we WOULD write.
      const blocks = (liveHtml.trim().length > 0) ? htmlToPokeBlocks(liveHtml) : [];
      manualPayload = { kind: 'pokeprices', content: JSON.stringify({ slug: a.slug, headline: a.title, blocks }, null, 2) };
      adapterStatus = 'preview';
    }
    payload = { adapter: 'pokeprices_external', target_slug: a.slug, canonical: publicationUrl, ...(targetRecordId ? { target_record_id: targetRecordId } : {}), ...(adapterError ? { error: adapterError } : {}) };
  } else {
    return {
      ok: false, publicationId: '', publicationUrl: null, requiresManualAction: false, seoChangeId: null,
      error: `unsupported publication_target: ${a.publication_target}`,
    };
  }

  // Live-URL verification: only for a real publish that the adapter
  // claims succeeded. Preview + failed-adapter skip verification.
  let verified: boolean | undefined;
  let verificationError: string | undefined;
  if (mode === 'publish' && adapterStatus === 'success') {
    // DB targets revalidate on next request so verification is fast.
    // External targets (Vercel git deploy on MTG, ISR on PP) can
    // take longer; the verifier polls with 6×10s backoff by default.
    const v = await verifyLiveUrl({
      url: publicationUrl,
      slug: a.slug,
      titleFragment: a.title.split(/\s+/).slice(0, 3).join(' '),
      maxAttempts: a.publication_target === 'mtgprices_markdown' ? 12 : 6,
      intervalMs: 10_000,
    });
    verified = v.ok;
    if (!v.ok) {
      verificationError = v.error ?? `status ${v.status}`;
      adapterStatus = 'failed';
    }
  }

  // Insert publication row (always — successful, failed, and
  // preview attempts all leave an audit entry).
  const { data: pubIns, error: pubErr } = await sb
    .from('network_content_publications')
    .insert({
      article_id: a.id,
      site_id: a.site_id,
      publication_target: a.publication_target,
      target_record_id: targetRecordId ?? null,
      commit_sha: commitSha ?? null,
      publication_url: publicationUrl,
      payload: payload as unknown as Record<string, unknown>,
      status: adapterStatus,
      attempted_at: new Date().toISOString(),
      completed_at: adapterStatus === 'success' ? new Date().toISOString() : null,
      error_summary: adapterError ?? verificationError ?? null,
      metadata: { mode, live_html_bytes: liveHtml.length, verified: verified ?? null } as unknown as Record<string, unknown>,
    })
    .select('id').single();
  if (pubErr) throw new Error(`[publish] insert publication: ${pubErr.message}`);
  const publicationId = (pubIns as { id: string }).id;

  let seoChangeId: string | null = null;

  if (mode === 'publish') {
    // Flip article status. On success, mark 'published' + record
    // published_at. On adapter OR verification failure, flip to
    // 'failed' so the editor shows it needs intervention rather
    // than appearing as "publishing" indefinitely.
    const newStatus =
      adapterStatus === 'success' ? 'published'
      : adapterStatus === 'failed' ? 'failed'
      : 'publishing';
    const update: Record<string, unknown> = {
      status: newStatus,
      publication_url: publicationUrl,
    };
    if (adapterStatus === 'success') {
      update['published_at'] = new Date().toISOString();
    }
    await sb.from('network_articles').update(update).eq('id', a.id);

    // Record SEO change (even for manual_pending; the operator will
    // later confirm, but we want the before/after window to start now).
    const { data: seoChange, error: seoErr } = await sb
      .from('network_seo_changes')
      .insert({
        site_id: a.site_id,
        change_type: 'content',
        title: `Published article: ${a.title}`,
        description: a.summary ?? a.meta_description,
        url: publicationUrl,
        source: 'ai',
        actor: 'Collector Network OS',
        actor_user_id: adminId,
        status: adapterStatus === 'success' ? 'deployed' : 'proposed',
        evidence: { article_id: a.id, publication_id: publicationId, primary_query: a.primary_query } as unknown as Record<string, unknown>,
      })
      .select('id').single();
    if (!seoErr && seoChange) {
      seoChangeId = (seoChange as { id: string }).id;
      await sb.from('network_articles').update({ seo_change_id: seoChangeId }).eq('id', a.id);
      await sb.from('network_content_publications').update({ seo_change_id: seoChangeId }).eq('id', publicationId);
    }

    // Flip originating idea → 'published' only when the article is
    // genuinely live. Failed publishes keep the idea at its prior
    // state so the queue surfaces the problem.
    if (adapterStatus === 'success') {
      const { data: ideaLink } = await sb.from('network_articles').select('idea_id').eq('id', a.id).maybeSingle();
      const ideaId = (ideaLink as { idea_id: string | null } | null)?.idea_id;
      if (ideaId) {
        await sb.from('network_content_ideas').update({ status: 'published' }).eq('id', ideaId);
      }

      // Fire IndexNow submission for Bing. Non-blocking — a failed
      // submission is a soft problem and must not retroactively mark
      // the publish as failed. The site must have indexnow_enabled.
      try { await autoSubmitBingIndexNow(sb, { articleId: a.id, siteId: a.site_id, url: publicationUrl }); }
      catch { /* ignore — the function already logs */ }
    }

    await sb.rpc('network_log_audit', {
      p_action: adapterStatus === 'success' ? 'article.published' : adapterStatus === 'failed' ? 'article.publish_failed' : 'article.manual_pending',
      p_entity_type: 'network_article',
      p_entity_id: a.id,
      p_site_id: a.site_id,
      p_old_value: { status: a.status } as unknown as Record<string, unknown>,
      p_new_value: { status: newStatus, publication_url: publicationUrl, publication_id: publicationId, seo_change_id: seoChangeId } as unknown as Record<string, unknown>,
      p_actor_type: 'human',
      p_source: 'manual',
      p_metadata: { target: a.publication_target } as unknown as Record<string, unknown>,
    });

    // For DB-driven sites, revalidate the public /insights path on
    // the target site. We can't reach cross-app revalidation from
    // here directly — the three sites use their own ISR/SSR config
    // (revalidate=1800 on the YGO slug page). Operator confirms via
    // the publish-complete button after publishing.
  } else {
    // Preview mode — audit without state change.
    await sb.rpc('network_log_audit', {
      p_action: 'article.preview_published',
      p_entity_type: 'network_article',
      p_entity_id: a.id,
      p_site_id: a.site_id,
      p_old_value: null,
      p_new_value: { preview_publication_id: publicationId, target: a.publication_target } as unknown as Record<string, unknown>,
      p_actor_type: 'human',
      p_source: 'manual',
      p_metadata: {} as unknown as Record<string, unknown>,
    });
  }

  return {
    ok: adapterStatus === 'success' || adapterStatus === 'preview',
    publicationId, publicationUrl,
    // Legacy field: no adapter is "manual pending" after Slice C —
    // all five publish synchronously. Kept false for API stability.
    requiresManualAction: false,
    manualPayload, seoChangeId,
    verified, verificationError,
    error: adapterStatus === 'failed' ? (adapterError ?? verificationError ?? 'publish failed') : undefined,
  };
}

/**
 * Schedule an article for later publishing. Validates the time is in
 * the future, flips status→'scheduled', records scheduled_for +
 * scheduled_by. The /api/cron/publish-scheduled cron picks it up on
 * the next tick that matches scheduled_for <= now().
 */
export async function scheduleArticle(
  sb: SupabaseClient,
  args: { articleId: string; scheduledForIso: string; adminId: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const { data: artRow, error } = await sb.from('network_articles')
    .select('id, site_id, status').eq('id', args.articleId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!artRow) return { ok: false, error: 'article not found' };
  const a = artRow as { id: string; site_id: string; status: string };
  if (!['approved', 'scheduled'].includes(a.status)) {
    return { ok: false, error: `article must be status='approved' before scheduling (current: ${a.status})` };
  }
  const whenMs = Date.parse(args.scheduledForIso);
  if (!Number.isFinite(whenMs) || whenMs <= Date.now()) {
    return { ok: false, error: 'scheduled_for must be a valid ISO datetime in the future' };
  }
  const { error: updErr } = await sb.from('network_articles').update({
    status: 'scheduled',
    scheduled_for: new Date(whenMs).toISOString(),
    scheduled_by: args.adminId,
  }).eq('id', args.articleId);
  if (updErr) return { ok: false, error: updErr.message };
  await sb.rpc('network_log_audit', {
    p_action: 'article.scheduled',
    p_entity_type: 'network_article',
    p_entity_id: args.articleId,
    p_site_id: a.site_id,
    p_old_value: { status: a.status } as unknown as Record<string, unknown>,
    p_new_value: { status: 'scheduled', scheduled_for: new Date(whenMs).toISOString() } as unknown as Record<string, unknown>,
    p_actor_type: 'human', p_source: 'manual',
    p_metadata: {} as unknown as Record<string, unknown>,
  });
  return { ok: true };
}

export async function cancelSchedule(
  sb: SupabaseClient,
  articleId: string,
  adminId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { data: artRow } = await sb.from('network_articles')
    .select('id, status, site_id').eq('id', articleId).maybeSingle();
  if (!artRow) return { ok: false, error: 'article not found' };
  const a = artRow as { id: string; status: string; site_id: string };
  if (a.status !== 'scheduled') return { ok: false, error: `not scheduled (status: ${a.status})` };
  const { error } = await sb.from('network_articles').update({
    status: 'approved',
    scheduled_for: null,
    scheduled_by: null,
  }).eq('id', articleId);
  if (error) return { ok: false, error: error.message };
  await sb.rpc('network_log_audit', {
    p_action: 'article.schedule_cancelled',
    p_entity_type: 'network_article', p_entity_id: articleId,
    p_site_id: a.site_id, p_old_value: null,
    p_new_value: { status: 'approved' } as unknown as Record<string, unknown>,
    p_actor_type: 'human', p_source: 'manual',
    p_metadata: { actor: adminId } as unknown as Record<string, unknown>,
  });
  return { ok: true };
}

/**
 * Cron entry point. Called by /api/cron/publish-scheduled. Looks up
 * every article whose scheduled_for is in the past, atomically
 * claims each via network_claim_scheduled_article (advisory lock
 * + CAS on status), and publishes it.
 */
export async function runScheduledPublishBatch(
  sb: SupabaseClient,
  opts: { max?: number } = {},
): Promise<Array<{ articleId: string; outcome: 'published' | 'claim_skipped' | 'failed'; error?: string }>> {
  const limit = opts.max ?? 10;
  const nowIso = new Date().toISOString();
  const { data: due } = await sb.from('network_articles')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  const rows = (due ?? []) as Array<{ id: string }>;
  const results: Array<{ articleId: string; outcome: 'published' | 'claim_skipped' | 'failed'; error?: string }> = [];
  for (const r of rows) {
    const { data: claimed, error: claimErr } = await sb.rpc('network_claim_scheduled_article', { p_article_id: r.id });
    if (claimErr || claimed === false) {
      results.push({ articleId: r.id, outcome: 'claim_skipped', error: claimErr?.message });
      continue;
    }
    try {
      // scheduled_by is the "actor" for the publish audit, which lets
      // the audit log carry the human who set the schedule rather
      // than attributing the cron run.
      const { data: schedBy } = await sb.from('network_articles')
        .select('scheduled_by').eq('id', r.id).maybeSingle();
      const adminId = (schedBy as { scheduled_by: string | null } | null)?.scheduled_by ?? null;
      // Reset status to 'approved' so the publish function's
      // approval gate passes. The claim RPC already took us to
      // 'publishing' — we flip through 'approved' briefly inside
      // publishArticle to pass its gate.
      await sb.from('network_articles').update({ status: 'approved' }).eq('id', r.id);
      const pub = await publishArticle(sb, r.id, adminId, 'publish');
      if (pub.ok) results.push({ articleId: r.id, outcome: 'published' });
      else results.push({ articleId: r.id, outcome: 'failed', error: pub.error ?? 'unknown' });
    } catch (err) {
      results.push({ articleId: r.id, outcome: 'failed', error: (err as Error).message.slice(0, 300) });
    }
  }
  return results;
}

/**
 * Public read for DB-driven articles. Used by the three monorepo
 * sites' /insights/[slug] routes as a fallback when the hardcoded
 * registry doesn't contain the slug. Only returns 'published'
 * articles belonging to that site.
 */
export async function fetchPublishedDbArticle(
  sb: SupabaseClient,
  siteSlug: 'ygo' | 'onepiece' | 'lorcana',
  slug: string,
): Promise<{
  id: string; title: string; summary: string | null; body: string; body_format: string;
  meta_title: string | null; meta_description: string | null;
  publication_url: string | null; published_at: string | null; updated_at: string;
  author: string;
} | null> {
  const target = `${siteSlug}_db` as PubTarget;
  const { data, error } = await sb
    .from('network_articles')
    .select('id, title, summary, body, body_format, meta_title, meta_description, publication_url, published_at, updated_at, author, publication_target, status')
    .eq('slug', slug).eq('status', 'published').eq('publication_target', target).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    id: string; title: string; summary: string | null; body: string; body_format: string;
    meta_title: string | null; meta_description: string | null;
    publication_url: string | null; published_at: string | null; updated_at: string;
    author: string;
  };
  return row;
}

/**
 * List published DB-driven articles for a site. Used for /insights
 * index pages to merge DB articles with the hardcoded registry.
 */
export async function listPublishedDbArticles(
  sb: SupabaseClient,
  siteSlug: 'ygo' | 'onepiece' | 'lorcana',
): Promise<Array<{ slug: string; title: string; summary: string | null; published_at: string | null; updated_at: string }>> {
  const target = `${siteSlug}_db` as PubTarget;
  const { data } = await sb
    .from('network_articles')
    .select('slug, title, summary, published_at, updated_at')
    .eq('status', 'published').eq('publication_target', target)
    .order('published_at', { ascending: false });
  return ((data ?? []) as unknown as Array<{ slug: string; title: string; summary: string | null; published_at: string | null; updated_at: string }>);
}
