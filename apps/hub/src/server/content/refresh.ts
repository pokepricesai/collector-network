import 'server-only';

// Content refresh intelligence. Deterministic — no AI.
//
// Scans the already-published Collector Network articles plus
// legacy site-level articles (where we can detect them via sitemap
// data) against GSC performance and emits refresh IDEAS, not
// automatic rewrites.
//
// Candidate signals:
//
//   • declining        — 28d clicks ≤ 50% of prior 28d (requires
//                        prior-period baseline ≥ 20 clicks).
//   • zero_impression  — article published >14 days ago but zero
//                        28d impressions. Likely indexing problem
//                        or dead content.
//   • striking_distance_article — article URL has 28d impressions
//                        ≥ 100 at avg position 4–20. A refresh +
//                        internal-link push could lift to page 1.
//   • low_ctr          — article URL has 28d impressions ≥ 500 and
//                        CTR < 1%. Title/meta rewrite candidate.
//   • new_queries      — queries newly landing on an article URL
//                        with ≥ 20 7d impressions that didn't
//                        appear in prior 21d — content could be
//                        expanded to answer them.
//
// Output goes to network_content_ideas with origin_type='refresh'
// so the content idea engine's routing taxonomy is preserved.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RefreshCandidate {
  article_id: string | null;      // null for site-native articles not in network_articles
  url: string;
  site_id: string;
  signal: 'declining' | 'zero_impression' | 'striking_distance_article' | 'low_ctr' | 'new_queries';
  severity: 'high' | 'normal' | 'low';
  evidence: Record<string, unknown>;
  reason: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export async function detectRefreshCandidatesForSite(
  sb: SupabaseClient,
  siteId: string,
): Promise<RefreshCandidate[]> {
  const now = new Date();
  const w28_end = new Date(now); w28_end.setUTCDate(w28_end.getUTCDate() - 1);
  const w28_start = new Date(w28_end); w28_start.setUTCDate(w28_start.getUTCDate() - 27);
  const prior_end = new Date(w28_start); prior_end.setUTCDate(prior_end.getUTCDate() - 1);
  const prior_start = new Date(prior_end); prior_start.setUTCDate(prior_start.getUTCDate() - 27);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // Fetch Collector Network published articles for this site + any
  // of its site-native /insights/* URLs the sitemap monitor knows
  // about. For the three monorepo sites, DB articles live in
  // network_articles; site-native articles are hardcoded.
  const { data: netArticles } = await sb.from('network_articles')
    .select('id, slug, publication_url, published_at')
    .eq('site_id', siteId).eq('status', 'published');
  const articleRows = ((netArticles ?? []) as Array<{ id: string; slug: string; publication_url: string | null; published_at: string | null }>)
    .filter((r) => !!r.publication_url);

  const candidateUrls = new Set<string>();
  const urlToArticle = new Map<string, { id: string; slug: string; published_at: string | null }>();
  for (const a of articleRows) {
    if (!a.publication_url) continue;
    candidateUrls.add(a.publication_url);
    urlToArticle.set(a.publication_url, { id: a.id, slug: a.slug, published_at: a.published_at });
  }

  // We also want to flag existing site-native articles the sitemap
  // monitor has observed via /insights/<something> URLs. Pull the
  // latest sitemap snapshot's shard-URL list.
  const { data: snap } = await sb.from('network_sitemap_snapshots')
    .select('metadata').eq('site_id', siteId)
    .order('snapshot_at', { ascending: false }).limit(1).maybeSingle();
  const shards = ((snap as { metadata?: { shards?: Array<{ url: string }> } } | null)?.metadata?.shards ?? []);
  // If the site has a sitemap-pages or sitemap-insights shard we can
  // scan the body for /insights URLs, but that requires another fetch
  // we're not making here. For Phase 4 we scope refresh to KNOWN
  // network_articles + any URL already appearing in url_daily that
  // matches an /insights/ path.
  void shards;

  // Pull all GSC url_daily rows for 28d + prior 28d for this site.
  // We paginate because the volume can be high for PokePrices.
  interface UrlDayRow { page: string; clicks: number; impressions: number; position_avg: number | null }
  async function fetchUrlDaily(from: string, to: string): Promise<UrlDayRow[]> {
    const out: UrlDayRow[] = [];
    let offset = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await sb.from('network_gsc_url_daily')
        .select('page, clicks, impressions, position_avg')
        .eq('site_id', siteId).gte('date', from).lte('date', to)
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`[refresh] url_daily: ${error.message}`);
      const rows = (data ?? []) as unknown as UrlDayRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
      if (offset > 1_000_000) break;
    }
    return out;
  }

  const [cur, prior] = await Promise.all([
    fetchUrlDaily(iso(w28_start), iso(w28_end)),
    fetchUrlDaily(iso(prior_start), iso(prior_end)),
  ]);

  // Aggregate per-URL for both windows.
  function aggregate(rows: UrlDayRow[]): Map<string, { clicks: number; impressions: number; posW: number; posD: number }> {
    const acc = new Map<string, { clicks: number; impressions: number; posW: number; posD: number }>();
    for (const r of rows) {
      let entry = acc.get(r.page);
      if (!entry) { entry = { clicks: 0, impressions: 0, posW: 0, posD: 0 }; acc.set(r.page, entry); }
      entry.clicks += r.clicks;
      entry.impressions += r.impressions;
      if (r.position_avg != null) {
        entry.posW += r.impressions * r.position_avg;
        entry.posD += r.impressions;
      }
    }
    return acc;
  }
  const curAgg = aggregate(cur);
  const priorAgg = aggregate(prior);

  const out: RefreshCandidate[] = [];

  // Candidate 1 — declining network articles.
  for (const [url, info] of urlToArticle) {
    const c = curAgg.get(url);
    const p = priorAgg.get(url);
    if (!p || p.clicks < 20) continue;
    const curClicks = c?.clicks ?? 0;
    const delta = (curClicks - p.clicks) / p.clicks;
    if (delta <= -0.5) {
      out.push({
        article_id: info.id, url, site_id: siteId,
        signal: 'declining',
        severity: p.clicks >= 100 ? 'high' : 'normal',
        evidence: { prior_28d_clicks: p.clicks, current_28d_clicks: curClicks, pct_change: delta, published_at: info.published_at },
        reason: `Clicks fell ${Math.round(Math.abs(delta) * 100)}% in the last 28d vs the prior 28d (${p.clicks} → ${curClicks}).`,
      });
    }
  }

  // Candidate 2 — zero-impression articles published >14 days ago.
  const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14);
  for (const [url, info] of urlToArticle) {
    const c = curAgg.get(url);
    if (c && c.impressions > 0) continue;
    if (!info.published_at) continue;
    if (new Date(info.published_at) > fourteenDaysAgo) continue;
    out.push({
      article_id: info.id, url, site_id: siteId,
      signal: 'zero_impression',
      severity: 'normal',
      evidence: { published_at: info.published_at, days_since_publish: Math.round((now.getTime() - new Date(info.published_at).getTime()) / 86400000) },
      reason: `No GSC impressions over the last 28 days despite being published more than 14 days ago. Likely indexing or discovery problem.`,
    });
  }

  // Candidate 3 — striking_distance_article (URL has pos 4-20 with ≥100 impressions)
  for (const [url, info] of urlToArticle) {
    const c = curAgg.get(url);
    if (!c) continue;
    const pos = c.posD > 0 ? c.posW / c.posD : 0;
    if (c.impressions < 100) continue;
    if (pos < 4 || pos > 20) continue;
    out.push({
      article_id: info.id, url, site_id: siteId,
      signal: 'striking_distance_article',
      severity: c.impressions >= 1000 ? 'high' : 'normal',
      evidence: { impressions_28d: c.impressions, clicks_28d: c.clicks, position_28d: pos, published_at: info.published_at },
      reason: `Ranks at avg position ${pos.toFixed(1)} with ${c.impressions.toLocaleString()} impressions over 28d. A refresh + internal-link push could land this on page 1.`,
    });
  }

  // Candidate 4 — low_ctr on the article URL.
  for (const [url, info] of urlToArticle) {
    const c = curAgg.get(url);
    if (!c) continue;
    if (c.impressions < 500) continue;
    const ctr = c.clicks / c.impressions;
    if (ctr >= 0.01) continue;
    out.push({
      article_id: info.id, url, site_id: siteId,
      signal: 'low_ctr',
      severity: c.impressions >= 2000 ? 'high' : 'normal',
      evidence: { impressions_28d: c.impressions, clicks_28d: c.clicks, ctr, published_at: info.published_at },
      reason: `${c.impressions.toLocaleString()} impressions, ${c.clicks} clicks (CTR ${(ctr * 100).toFixed(2)}%). Title/meta rewrite candidate.`,
    });
  }

  // Candidate 5 — new_queries landing on an article URL. Requires
  // network_gsc_url_query_daily; we only flag the URL and the
  // emerging queries, not individual queries.
  const since7 = new Date(now); since7.setUTCDate(since7.getUTCDate() - 7);
  const { data: uqRaw7 } = await sb.from('network_gsc_url_query_daily')
    .select('page, query, impressions').eq('site_id', siteId)
    .gte('date', iso(since7)).in('page', [...urlToArticle.keys()]).limit(5000);
  const { data: uqRaw21 } = await sb.from('network_gsc_url_query_daily')
    .select('page, query').eq('site_id', siteId)
    .gte('date', iso(prior_start)).lt('date', iso(since7)).in('page', [...urlToArticle.keys()]).limit(10000);
  const priorKeys = new Set(((uqRaw21 ?? []) as Array<{ page: string; query: string }>).map((r) => `${r.page}|${r.query}`));
  const perUrl = new Map<string, Array<{ query: string; impressions: number }>>();
  for (const r of ((uqRaw7 ?? []) as Array<{ page: string; query: string; impressions: number }>)) {
    if (priorKeys.has(`${r.page}|${r.query}`)) continue;
    if (r.impressions < 20) continue;
    let arr = perUrl.get(r.page);
    if (!arr) { arr = []; perUrl.set(r.page, arr); }
    arr.push({ query: r.query, impressions: r.impressions });
  }
  for (const [url, queries] of perUrl) {
    const info = urlToArticle.get(url);
    if (!info) continue;
    const sorted = queries.sort((a, b) => b.impressions - a.impressions).slice(0, 5);
    const total = sorted.reduce((a, b) => a + b.impressions, 0);
    if (total < 40) continue;      // noise floor
    out.push({
      article_id: info.id, url, site_id: siteId,
      signal: 'new_queries',
      severity: total >= 500 ? 'high' : 'normal',
      evidence: { new_queries: sorted, total_new_impressions_7d: total },
      reason: `${sorted.length} new queries started landing on this article in the last 7d (${total.toLocaleString()} impressions). Content could be expanded to answer them.`,
    });
  }

  return out;
}

/**
 * Promote detected refresh candidates into network_content_ideas
 * with origin_type='refresh'. Dedupe key is stable per
 * (article_id, signal) so re-runs refresh evidence rather than
 * creating duplicates.
 */
export async function createRefreshIdeas(
  sb: SupabaseClient,
  siteId: string,
): Promise<{ generated: number; refreshed: number; dismissed_stale: number }> {
  const candidates = await detectRefreshCandidatesForSite(sb, siteId);
  const now = new Date().toISOString();

  // Load existing refresh ideas for this site so we can detect
  // generated vs refreshed and later stale-sweep.
  const { data: existing } = await sb.from('network_content_ideas')
    .select('dedupe_key').eq('site_id', siteId).like('dedupe_key', 'refresh:%');
  const existingKeys = new Set(((existing ?? []) as Array<{ dedupe_key: string }>).map((r) => r.dedupe_key));

  const rows = candidates.map((c) => {
    const titleBase =
      c.signal === 'declining' ? 'Refresh declining article' :
      c.signal === 'zero_impression' ? 'Investigate zero-impression article' :
      c.signal === 'striking_distance_article' ? 'Refresh striking-distance article' :
      c.signal === 'low_ctr' ? 'Rewrite low-CTR article title/meta' :
      'Expand article for new queries';
    return {
      site_id: siteId,
      content_type: 'editorial' as const,
      working_title: `${titleBase}: ${c.url.replace(/^https?:\/\/[^/]+/, '')}`,
      primary_query: null,
      secondary_queries: [],
      summary: c.reason,
      priority: c.severity,
      status: 'new' as const,
      origin_type: 'refresh',
      origin_id: c.article_id,
      evidence: { ...c.evidence, signal: c.signal, url: c.url, article_id: c.article_id },
      dedupe_key: `refresh:${c.signal}:${slugify(c.url)}`,
      last_seen_at: now,
    };
  });

  if (rows.length > 0) {
    const CHUNK = 500;
    for (let s = 0; s < rows.length; s += CHUNK) {
      const { error } = await sb.from('network_content_ideas')
        .upsert(rows.slice(s, s + CHUNK), { onConflict: 'site_id,dedupe_key' });
      if (error) throw new Error(`[refresh] upsert: ${error.message}`);
    }
  }

  // Stale-sweep refresh ideas whose dedupe key wasn't emitted this run.
  const emittedKeys = new Set(rows.map((r) => r.dedupe_key));
  const { data: openRefreshIdeas } = await sb.from('network_content_ideas')
    .select('id, dedupe_key').eq('site_id', siteId)
    .eq('origin_type', 'refresh').eq('status', 'new');
  let dismissed = 0;
  for (const r of ((openRefreshIdeas ?? []) as Array<{ id: string; dedupe_key: string }>)) {
    if (!emittedKeys.has(r.dedupe_key)) {
      await sb.from('network_content_ideas').update({ status: 'stale', last_seen_at: now }).eq('id', r.id);
      dismissed++;
    }
  }

  let generated = 0, refreshed = 0;
  for (const r of rows) if (existingKeys.has(r.dedupe_key)) refreshed++; else generated++;
  return { generated, refreshed, dismissed_stale: dismissed };
}
