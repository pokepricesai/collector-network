import 'server-only';

// Evidence pack builder.
//
// Deterministic. Pulls only from the shared Collector Network data
// surface. Produces a frozen, hashable JSON pack the AI will read.
//
// Data sources used (per audit):
//   * tcg_cards  — card catalogue (name, slug, images, rarity, gamedata)
//   * tcg_sets   — set catalogue (name, code, released_at)
//   * network_gsc_url_daily — per-URL search metrics (28d)
//   * network_articles — existing published articles for duplication detection
//   * No YGO pricing table is mirrored in the shared Supabase today
//     (pricing lives in a separate PokePrices project). The pack
//     builder therefore returns `market_data: []` for YGO, and the
//     quality gate will HOLD any opportunity whose template requires
//     market_data.
//
// Hashing: content_hash is sha256(canonical_json(payload)) so a byte-
// stable record exists for audit. Keys are sorted when hashing.

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ArticleTemplateId,
  CommercialLink,
  EvidenceImage,
  EvidenceInternalLink,
  EvidencePackPayload,
  EvidenceQualityVerdict,
  ExistingContentRef,
  MarketObservation,
  RelatedPage,
  SearchObservation,
} from './types';
import { getTemplate, BANNED_FILLER_PHRASES } from './templates';
import type { AutopilotSiteSlug } from './config';

export interface BuildPackInput {
  site_slug: AutopilotSiteSlug;
  site_name: string;
  site_id: string;
  template_id: ArticleTemplateId;
  working_title: string;
  primary_query: string | null;
  secondary_queries: string[];
  summary: string | null;
  date_range_days: number;
  // Caller can pass projected cost from the cost estimator so the
  // pack is a complete snapshot of what the AI will see.
  budget: {
    max_cost_usd: number;
    projected_draft_cost_usd: number;
    projected_qa_cost_usd: number | null;
  };
}

export async function buildEvidencePack(sb: SupabaseClient, input: BuildPackInput): Promise<{ payload: EvidencePackPayload; content_hash: string }> {
  const to = new Date();
  const from = new Date(to.getTime() - input.date_range_days * 86_400_000);
  const date_range = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };

  const [market_data, search_data, related_pages, existing_content, images, internal_links, commercial_links] = await Promise.all([
    fetchMarketData(sb, input, from, to),
    fetchSearchData(sb, input, from, to),
    fetchRelatedPages(sb, input),
    fetchExistingContent(sb, input),
    fetchImages(sb, input),
    fetchInternalLinks(sb, input),
    fetchCommercialLinks(sb, input),
  ]);

  const template = getTemplate(input.template_id);
  const payload: EvidencePackPayload = {
    schema_version: '1',
    site: { slug: input.site_slug, name: input.site_name },
    topic: {
      kind: input.template_id,
      working_title: input.working_title,
      primary_query: input.primary_query,
      secondary_queries: input.secondary_queries,
      summary: input.summary,
    },
    date_range,
    methodology: methodologyFor(input.template_id, input.date_range_days),
    market_data,
    search_data,
    related_pages,
    internal_links,
    existing_content,
    images,
    commercial_links,
    generation_constraints: {
      template_id: input.template_id,
      max_output_tokens: 4000,
      target_word_count_min: 300,
      target_word_count_max: template.id === 'card_guide' ? 900 : template.id === 'set_guide' ? 1100 : template.id === 'evergreen_guide' ? 1300 : 700,
      banned_phrases: [...BANNED_FILLER_PHRASES],
    },
    budget: {
      max_cost_usd: input.budget.max_cost_usd,
      projected_draft_cost_usd: input.budget.projected_draft_cost_usd,
      projected_qa_cost_usd: input.budget.projected_qa_cost_usd,
      projected_total_cost_usd: input.budget.projected_draft_cost_usd + (input.budget.projected_qa_cost_usd ?? 0),
    },
  };

  const content_hash = hashCanonical(payload);
  return { payload, content_hash };
}

export function evaluateEvidenceQuality(payload: EvidencePackPayload): EvidenceQualityVerdict {
  const hold_reasons: string[] = [];
  const warnings: string[] = [];
  const t = getTemplate(payload.topic.kind);

  const needMarket = t.min_evidence.market_data ?? 0;
  const needImages = t.min_evidence.images ?? 0;
  if (payload.market_data.length < needMarket) {
    hold_reasons.push('evidence_insufficient');
  }
  if (payload.images.length < needImages) {
    hold_reasons.push('image_missing');
  }
  if (payload.existing_content.some((e) => e.overlap_score >= 0.75)) {
    hold_reasons.push('duplicate_topic');
  }
  // Freshness warning for market observations (not blocker — just surface).
  const stale = payload.market_data.filter((m) => daysBetween(m.end_date, payload.date_range.to) > 7).length;
  if (stale > 0) warnings.push(`${stale} market observation(s) are more than 7 days old relative to the pack's date range.`);

  // Dedup check — hard block if hold_reasons has duplicate_topic (above).
  const status = hold_reasons.length > 0 ? 'held' : 'ready';
  return { status, hold_reasons, warnings };
}

export interface PersistPackInput {
  sb: SupabaseClient;
  payload: EvidencePackPayload;
  content_hash: string;
  idea_id: string | null;
  article_id: string | null;
  autopilot_run_id: string | null;
}
export async function persistEvidencePack(input: PersistPackInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await input.sb
    .from('network_article_evidence_packs')
    .insert({
      article_id: input.article_id,
      idea_id: input.idea_id,
      autopilot_run_id: input.autopilot_run_id,
      schema_version: input.payload.schema_version,
      content_hash: input.content_hash,
      payload: input.payload as unknown as Record<string, unknown>,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

// ─── Fetchers ──────────────────────────────────────────────────

async function fetchMarketData(_sb: SupabaseClient, input: BuildPackInput, _from: Date, _to: Date): Promise<MarketObservation[]> {
  // No YGO pricing table in the shared Supabase (confirmed by audit).
  // Return [] rather than inventing data. Caller handles the empty
  // case via the evidence quality gate.
  //
  // When a YGO pricing provider lands, replace this with a real
  // fetch keyed by game_id='ygo'. The return shape is already
  // specified above and the executor + QA assume it.
  if (input.site_slug === 'ygo') return [];
  return [];
}

async function fetchSearchData(sb: SupabaseClient, input: BuildPackInput, from: Date, to: Date): Promise<SearchObservation[]> {
  // Pull per-URL rows for the site in the window; aggregate into
  // SearchObservation per URL. If the window has <10 rows for the
  // target URL(s), the striking-distance signal will come out low
  // and the scorer will reflect that.
  const since = from.toISOString().slice(0, 10);
  const until = to.toISOString().slice(0, 10);
  const { data } = await sb
    .from('network_gsc_url_daily')
    .select('date, page, clicks, impressions, position_avg')
    .eq('site_id', input.site_id)
    .gte('date', since)
    .lte('date', until)
    .limit(5000);
  const rows = (data ?? []) as Array<{ date: string; page: string; clicks: number; impressions: number; position_avg: number }>;

  const byPage = new Map<string, { impressions: number; clicks: number; position_sum_weighted: number; days: number }>();
  for (const r of rows) {
    const b = byPage.get(r.page) ?? { impressions: 0, clicks: 0, position_sum_weighted: 0, days: 0 };
    b.impressions += r.impressions ?? 0;
    b.clicks += r.clicks ?? 0;
    b.position_sum_weighted += (r.position_avg ?? 0) * (r.impressions ?? 0);
    b.days += 1;
    byPage.set(r.page, b);
  }
  const observations: SearchObservation[] = Array.from(byPage.entries())
    .map(([page_url, b]) => ({
      query: '',                     // page-level aggregate; query-specific pack extension can land later
      page_url,
      impressions: b.impressions,
      clicks: b.clicks,
      ctr: b.impressions > 0 ? b.clicks / b.impressions : 0,
      avg_position: b.impressions > 0 ? b.position_sum_weighted / b.impressions : 0,
      period_days: b.days,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25);
  void until;
  return observations;
}

async function fetchRelatedPages(sb: SupabaseClient, input: BuildPackInput): Promise<RelatedPage[]> {
  // Related = sets + top-ranked existing published articles.
  const { data: setData } = await sb
    .from('tcg_sets')
    .select('name, code')
    .eq('game_id', input.site_slug)
    .order('released_at', { ascending: false, nullsFirst: false })
    .limit(10);
  const sets = ((setData ?? []) as Array<{ name: string; code: string }>).map((s) => ({
    url: `https://ygoprices.io/sets/${s.code.toLowerCase()}`,
    title: s.name,
    kind: 'set' as const,
    slug: s.code.toLowerCase(),
  }));

  const { data: articleData } = await sb
    .from('network_articles')
    .select('slug, title')
    .eq('site_id', input.site_id)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(10);
  const articles = ((articleData ?? []) as Array<{ slug: string; title: string }>).map((a) => ({
    url: `https://ygoprices.io/insights/${a.slug}`,
    title: a.title,
    kind: 'article' as const,
    slug: a.slug,
  }));

  return [...sets, ...articles].slice(0, 20);
}

async function fetchExistingContent(sb: SupabaseClient, input: BuildPackInput): Promise<ExistingContentRef[]> {
  const { data } = await sb
    .from('network_articles')
    .select('id, slug, title, published_at, publication_url')
    .eq('site_id', input.site_id)
    .in('status', ['published', 'approved', 'scheduled', 'review']);
  const rows = (data ?? []) as Array<{ id: string; slug: string; title: string; published_at: string | null; publication_url: string | null }>;
  // We don't currently have per-article GSC rollups keyed by article
  // id, so fill clicks/impressions/position with zeros for the first
  // iteration. Overlap is computed by lexical similarity against the
  // proposed working_title.
  const topic = input.working_title.toLowerCase();
  const topicTokens = new Set(topic.split(/[^a-z0-9]+/).filter(Boolean));
  return rows.map((r) => {
    const titleTokens = new Set(r.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const inter = Array.from(topicTokens).filter((t) => titleTokens.has(t)).length;
    const union = new Set([...topicTokens, ...titleTokens]).size;
    const overlap = union === 0 ? 0 : inter / union;
    const ageDays = r.published_at ? Math.max(0, Math.floor((Date.now() - new Date(r.published_at).getTime()) / 86_400_000)) : null;
    return {
      article_id: r.id,
      slug: r.slug,
      url: r.publication_url ?? `https://ygoprices.io/insights/${r.slug}`,
      title: r.title,
      overlap_score: overlap,
      gsc_28d_clicks: 0,
      gsc_28d_impressions: 0,
      gsc_28d_position: null,
      age_days: ageDays,
    };
  });
}

async function fetchImages(sb: SupabaseClient, input: BuildPackInput): Promise<EvidenceImage[]> {
  // tcg_cards.images JSONB: { large, normal, small } URLs.
  const { data } = await sb
    .from('tcg_cards')
    .select('name, collector_number, images')
    .eq('game_id', input.site_slug)
    .not('images', 'is', null)
    .limit(12);
  const rows = (data ?? []) as Array<{ name: string; collector_number: string | null; images: { large?: string; normal?: string; small?: string } | null }>;
  const out: EvidenceImage[] = [];
  for (const r of rows) {
    const url = r.images?.large ?? r.images?.normal ?? r.images?.small;
    if (!url) continue;
    out.push({
      media_id: null,
      source_url: url,
      alt_text: r.collector_number ? `${r.name} (${r.collector_number})` : r.name,
      width: null,
      height: null,
      card_slug: null,
      set_code: null,
      role_suggestion: out.length === 0 ? 'featured' : 'inline',
    });
    if (out.length >= 6) break;
  }
  return out;
}

async function fetchInternalLinks(_sb: SupabaseClient, _input: BuildPackInput): Promise<EvidenceInternalLink[]> {
  // Checkpoint B foundation: we don't yet have an internal-link
  // opportunities table scoped to a specific candidate article, so
  // return [] for now. The scorer treats this as low internal-link
  // opportunity. A follow-up checkpoint will plug the existing
  // network_internal_link_opportunities engine into this fetcher.
  return [];
}

async function fetchCommercialLinks(sb: SupabaseClient, input: BuildPackInput): Promise<CommercialLink[]> {
  // We build a representative eBay link for each of the top candidate
  // cards (by name match on tcg_cards). SharedId is the YGO EPN
  // campaign (5339152105) which the Impact coverage audit confirmed
  // is in-force; see server/impact/coverage-audit.ts.
  if (input.site_slug !== 'ygo') return [];
  const { data } = await sb
    .from('tcg_cards')
    .select('name, collector_number')
    .eq('game_id', 'ygo')
    .limit(8);
  const rows = (data ?? []) as Array<{ name: string; collector_number: string | null }>;
  return rows.slice(0, 5).map((r) => ({
    destination: 'ebay' as const,
    card_slug: r.collector_number?.toLowerCase() ?? r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    card_name: r.name,
    url: buildEbaySearchUrl(r.name),
    tracking: {
      shared_id: '5339152105',
      sub_id_1: input.site_slug,
      sub_id_2: 'autopilot',
    },
  }));
}

// ─── Helpers ───────────────────────────────────────────────────

function buildEbaySearchUrl(cardName: string): string {
  // Minimal hub-side search URL. The YGO site's own link builder
  // (apps/yugioh/src/lib/ebay.ts) is the canonical builder for live
  // outbound links; this is only used inside the evidence pack to
  // demonstrate that an eBay destination exists.
  const q = encodeURIComponent(`Yu-Gi-Oh! ${cardName}`);
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${q}&campid=5339152105`;
}

function methodologyFor(template_id: ArticleTemplateId, days: number): string {
  switch (template_id) {
    case 'market_movers':
      return `Observed price movement across tracked Yu-Gi-Oh! card printings between ${days} days ago and today. Movers meet a minimum observation count, a minimum absolute change, and a maximum percentage-change cap to filter out thin-data outliers.`;
    case 'card_guide':      return `Deterministic summary of tracked printings and price position for the subject card.`;
    case 'set_guide':       return `Overview of a single set using the tracked printings in the YGOPrices catalogue.`;
    case 'evergreen_guide': return `Reference piece written against the current YGO catalogue + 28-day search context.`;
    case 'refresh':         return `Reconciled refresh of an existing article against the latest ${days}-day data.`;
  }
}

function daysBetween(aYmd: string, bYmd: string): number {
  const a = new Date(aYmd + 'T00:00:00Z').getTime();
  const b = new Date(bYmd + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

// Canonical JSON stringify (sorted keys) + sha256. Pure function —
// identical input ⇒ identical hash.
function hashCanonical(obj: unknown): string {
  const canonical = canonicalise(obj);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
function canonicalise(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalise);
  const o = v as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) sorted[k] = canonicalise(o[k]);
  return sorted;
}
