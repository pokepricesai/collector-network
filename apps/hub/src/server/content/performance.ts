import 'server-only';

// Article performance helper. Joins published network_articles
// to their GSC url_daily observations and returns per-category
// panels for /admin/content.
//
// Respects GSC's ~3-day settlement lag by comparing 28d vs prior
// 28d where the current window ends at the latest `data_date`
// we actually hold rather than today.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ArticlePerformanceRow {
  article_id: string;
  site_id: string;
  site_slug: string;
  title: string;
  slug: string;
  publication_url: string;
  published_at: string | null;
  current_28d_clicks: number;
  current_28d_impressions: number;
  prior_28d_clicks: number;
  prior_28d_impressions: number;
  ctr_28d: number | null;
  position_28d: number | null;
  pct_change_clicks: number | null;
}

export interface ArticlePerformancePanels {
  top_performing: ArticlePerformanceRow[];
  gaining: ArticlePerformanceRow[];
  declining: ArticlePerformanceRow[];
  zero_impression: ArticlePerformanceRow[];
  refresh_candidates: ArticlePerformanceRow[];
}

export async function computeArticlePerformance(sb: SupabaseClient): Promise<ArticlePerformancePanels> {
  // Pull every published article that has a publication_url the GSC
  // tables may know about.
  const { data: articles } = await sb.from('network_articles')
    .select('id, site_id, title, slug, publication_url, published_at, network_sites(slug)')
    .eq('status', 'published').not('publication_url', 'is', null).limit(500);
  const arts = ((articles ?? []) as unknown as Array<{
    id: string; site_id: string; title: string; slug: string;
    publication_url: string | null; published_at: string | null;
    network_sites: { slug: string };
  }>).filter((a) => !!a.publication_url);

  if (arts.length === 0) return { top_performing: [], gaining: [], declining: [], zero_impression: [], refresh_candidates: [] };

  // Latest data_date per site, so each site's 28d window ends at
  // the newest observation it actually has.
  const siteIds = [...new Set(arts.map((a) => a.site_id))];
  const siteLatest = new Map<string, string>();
  for (const sid of siteIds) {
    const { data } = await sb.from('network_gsc_site_daily')
      .select('date').eq('site_id', sid).order('date', { ascending: false }).limit(1).maybeSingle();
    const latest = (data as { date: string } | null)?.date;
    if (latest) siteLatest.set(sid, latest);
  }

  // Pull aggregated url_daily per site for both windows.
  const bySiteUrl: Map<string, { cur: { clicks: number; impressions: number; posW: number; posD: number }; prior: { clicks: number; impressions: number } }> = new Map();
  for (const sid of siteIds) {
    const latest = siteLatest.get(sid);
    if (!latest) continue;
    const endCur = new Date(latest);
    const startCur = new Date(endCur); startCur.setUTCDate(startCur.getUTCDate() - 27);
    const endPrior = new Date(startCur); endPrior.setUTCDate(endPrior.getUTCDate() - 1);
    const startPrior = new Date(endPrior); startPrior.setUTCDate(startPrior.getUTCDate() - 27);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const urls = arts.filter((a) => a.site_id === sid).map((a) => a.publication_url!);

    async function paginate(from: string, to: string, urlSet: string[]): Promise<Array<{ page: string; clicks: number; impressions: number; position_avg: number | null }>> {
      const out: Array<{ page: string; clicks: number; impressions: number; position_avg: number | null }> = [];
      // Chunk the IN clause.
      const CHUNK = 100;
      for (let i = 0; i < urlSet.length; i += CHUNK) {
        const slice = urlSet.slice(i, i + CHUNK);
        const { data } = await sb.from('network_gsc_url_daily')
          .select('page, clicks, impressions, position_avg')
          .eq('site_id', sid).gte('date', from).lte('date', to)
          .in('page', slice);
        for (const r of ((data ?? []) as Array<{ page: string; clicks: number; impressions: number; position_avg: number | null }>)) out.push(r);
      }
      return out;
    }

    const [curRows, priorRows] = await Promise.all([
      paginate(iso(startCur), iso(endCur), urls),
      paginate(iso(startPrior), iso(endPrior), urls),
    ]);
    for (const r of curRows) {
      const key = `${sid}|${r.page}`;
      let entry = bySiteUrl.get(key);
      if (!entry) { entry = { cur: { clicks: 0, impressions: 0, posW: 0, posD: 0 }, prior: { clicks: 0, impressions: 0 } }; bySiteUrl.set(key, entry); }
      entry.cur.clicks += r.clicks;
      entry.cur.impressions += r.impressions;
      if (r.position_avg != null) { entry.cur.posW += r.impressions * r.position_avg; entry.cur.posD += r.impressions; }
    }
    for (const r of priorRows) {
      const key = `${sid}|${r.page}`;
      let entry = bySiteUrl.get(key);
      if (!entry) { entry = { cur: { clicks: 0, impressions: 0, posW: 0, posD: 0 }, prior: { clicks: 0, impressions: 0 } }; bySiteUrl.set(key, entry); }
      entry.prior.clicks += r.clicks;
      entry.prior.impressions += r.impressions;
    }
  }

  const rows: ArticlePerformanceRow[] = arts.map((a) => {
    const entry = bySiteUrl.get(`${a.site_id}|${a.publication_url}`);
    const cur = entry?.cur ?? { clicks: 0, impressions: 0, posW: 0, posD: 0 };
    const prior = entry?.prior ?? { clicks: 0, impressions: 0 };
    return {
      article_id: a.id, site_id: a.site_id, site_slug: a.network_sites.slug,
      title: a.title, slug: a.slug, publication_url: a.publication_url!,
      published_at: a.published_at,
      current_28d_clicks: cur.clicks, current_28d_impressions: cur.impressions,
      prior_28d_clicks: prior.clicks, prior_28d_impressions: prior.impressions,
      ctr_28d: cur.impressions > 0 ? cur.clicks / cur.impressions : null,
      position_28d: cur.posD > 0 ? cur.posW / cur.posD : null,
      pct_change_clicks: prior.clicks > 0 ? (cur.clicks - prior.clicks) / prior.clicks : null,
    };
  });

  const top = [...rows].sort((a, b) => b.current_28d_clicks - a.current_28d_clicks).slice(0, 10);
  const gaining = [...rows].filter((r) => (r.pct_change_clicks ?? 0) >= 0.3 && r.prior_28d_clicks >= 10).sort((a, b) => (b.pct_change_clicks ?? 0) - (a.pct_change_clicks ?? 0)).slice(0, 10);
  const declining = [...rows].filter((r) => (r.pct_change_clicks ?? 0) <= -0.3 && r.prior_28d_clicks >= 10).sort((a, b) => (a.pct_change_clicks ?? 0) - (b.pct_change_clicks ?? 0)).slice(0, 10);
  const now = Date.now();
  const zero = [...rows].filter((r) => r.current_28d_impressions === 0 && r.published_at && (now - new Date(r.published_at).getTime()) > 14 * 86400000).slice(0, 10);
  const refreshCandidates = [...rows].filter((r) => {
    if (r.current_28d_impressions >= 100 && r.position_28d != null && r.position_28d >= 4 && r.position_28d <= 20) return true;
    if (r.current_28d_impressions >= 500 && r.ctr_28d != null && r.ctr_28d < 0.01) return true;
    return false;
  }).sort((a, b) => b.current_28d_impressions - a.current_28d_impressions).slice(0, 10);

  return {
    top_performing: top,
    gaining, declining, zero_impression: zero,
    refresh_candidates: refreshCandidates,
  };
}
