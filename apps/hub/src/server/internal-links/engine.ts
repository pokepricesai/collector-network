import 'server-only';

// Internal-link opportunity engine (V1).
//
// What this engine CAN see:
//   • The 28-day set of URLs on each site that receive impressions
//     (`network_gsc_url_daily`).
//   • The queries each URL receives (via `network_gsc_url_query_daily`).
//   • The site's sitemap URLs (via `network_sitemap_snapshots.metadata`).
//
// What this engine does NOT yet have:
//   • Live crawl of outgoing hrefs per page.
//
// Given that, we detect the following opportunity classes:
//
//   • `orphan_gsc` — a URL has impressions but never co-occurs with
//     other same-site URLs that share a query (strong proxy for
//     "the rest of the site treats this page as isolated").
//   • `authority_handoff` — a page with substantial clicks + a
//     ranking page in the SAME directory with weak clicks. Linking
//     the authority page to the weak page is a classic internal-link
//     fix.
//   • `query_cluster_missing_link` — two pages that both rank for
//     the same query (same site) and are candidates to be reviewed
//     together. (Cannibalization-adjacent.)
//
// Heuristics are intentionally conservative and evidence-backed —
// no random keyword matches, no "pages that share a word".

import type { SupabaseClient } from '@supabase/supabase-js';

interface UrlDailyRow { page: string; clicks: number; impressions: number; }
interface UrlQueryRow { page: string; query: string; clicks: number; impressions: number; position_avg: number | null }

async function fetchPaged<T>(
  sb: SupabaseClient,
  table: string,
  cols: string,
  siteId: string,
  gteDate: string,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(cols)
      .eq('site_id', siteId)
      .gte('date', gteDate)
      .range(from, from + page - 1);
    if (error) throw new Error(`[internal-links] ${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < page) break;
    from += page;
    if (from > 1_000_000) break;
  }
  return out;
}

function parentDir(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    return parts.slice(0, -1).join('/');
  } catch { return null; }
}

export async function generateInternalLinkOpportunities(
  sb: SupabaseClient,
  siteId: string,
  today: Date,
): Promise<{ generated: number; updated: number }> {
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - 28);
  const sinceIso = since.toISOString().slice(0, 10);

  const [urls, urlQueries] = await Promise.all([
    fetchPaged<UrlDailyRow>(
      sb, 'network_gsc_url_daily',
      'page,clicks,impressions',
      siteId, sinceIso,
    ),
    fetchPaged<UrlQueryRow>(
      sb, 'network_gsc_url_query_daily',
      'page,query,clicks,impressions,position_avg',
      siteId, sinceIso,
    ),
  ]);

  // Aggregate URL-level totals.
  const urlTotals = new Map<string, { clicks: number; impressions: number; dir: string | null }>();
  for (const r of urls) {
    const prev = urlTotals.get(r.page);
    const dir = parentDir(r.page);
    if (!prev) urlTotals.set(r.page, { clicks: r.clicks, impressions: r.impressions, dir });
    else { prev.clicks += r.clicks; prev.impressions += r.impressions; }
  }

  // Build query -> participating URLs map.
  const queryToUrls = new Map<string, Map<string, { clicks: number; impressions: number; position: number }>>();
  for (const r of urlQueries) {
    if (!r.query || !r.page) continue;
    let m = queryToUrls.get(r.query);
    if (!m) { m = new Map(); queryToUrls.set(r.query, m); }
    const prev = m.get(r.page);
    if (!prev) m.set(r.page, { clicks: r.clicks, impressions: r.impressions, position: r.position_avg ?? 0 });
    else { prev.clicks += r.clicks; prev.impressions += r.impressions; }
  }

  interface Opp {
    source_url: string;
    target_url: string;
    reason: string;
    relationship: string | null;
    priority: 'critical' | 'high' | 'normal' | 'low';
    evidence: Record<string, unknown>;
    confidence: 'low' | 'medium' | 'high';
  }
  const opps: Opp[] = [];

  // --- Opportunity: authority_handoff -----------------------------
  //
  // For each directory, find the top-clicked page (`donor`) and the
  // worst-performing page with impressions (`recipient`). If the
  // donor has >= 10x the recipient's clicks AND the recipient has
  // 100+ impressions over 28d, propose a link from donor → recipient.
  const byDir = new Map<string, Array<{ url: string; clicks: number; impressions: number }>>();
  for (const [url, t] of urlTotals) {
    if (!t.dir) continue;
    if (t.impressions < 10) continue;
    let arr = byDir.get(t.dir);
    if (!arr) { arr = []; byDir.set(t.dir, arr); }
    arr.push({ url, clicks: t.clicks, impressions: t.impressions });
  }
  for (const [dir, arr] of byDir) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => b.clicks - a.clicks);
    const donor = arr[0]!;
    if (donor.clicks < 50) continue; // skip tiny directories
    for (const recipient of arr.slice(1)) {
      if (recipient.url === donor.url) continue;
      if (recipient.impressions < 100) continue;
      if (recipient.clicks * 10 > donor.clicks) continue;
      opps.push({
        source_url: donor.url,
        target_url: recipient.url,
        reason: 'authority_handoff',
        relationship: `dir:${dir}`,
        priority: donor.clicks >= 500 ? 'normal' : 'low',
        confidence: 'medium',
        evidence: {
          donor_clicks_28d: donor.clicks,
          recipient_clicks_28d: recipient.clicks,
          recipient_impressions_28d: recipient.impressions,
          directory: dir,
        },
      });
    }
  }

  // --- Opportunity: query_cluster_missing_link --------------------
  //
  // Two URLs both rank for the same query with meaningful impressions
  // each (≥50) — a review-together signal that is actionable as either
  // consolidation or a merge-link.
  for (const [query, urlsMap] of queryToUrls) {
    if (urlsMap.size < 2) continue;
    const participants = [...urlsMap.entries()]
      .filter(([, m]) => m.impressions >= 50)
      .sort((a, b) => b[1].impressions - a[1].impressions);
    if (participants.length < 2) continue;
    // Only emit for pairs within same site (we already filter by siteId).
    const [primary, secondary] = participants;
    if (!primary || !secondary) continue;
    opps.push({
      source_url: primary[0],
      target_url: secondary[0],
      reason: 'query_cluster_missing_link',
      relationship: `query:${query}`,
      priority: primary[1].impressions >= 1000 ? 'normal' : 'low',
      confidence: 'medium',
      evidence: {
        shared_query: query,
        primary_impressions_28d: primary[1].impressions,
        secondary_impressions_28d: secondary[1].impressions,
      },
    });
  }

  // --- Opportunity: orphan_gsc -----------------------------------
  //
  // A URL has impressions but shares no top-5 queries with any other
  // same-site URL. The site "doesn't talk about" this page.
  const urlTopQueries = new Map<string, Set<string>>();
  const perUrlQueries = new Map<string, Array<{ q: string; imp: number }>>();
  for (const r of urlQueries) {
    if (!r.query || !r.page) continue;
    let arr = perUrlQueries.get(r.page);
    if (!arr) { arr = []; perUrlQueries.set(r.page, arr); }
    arr.push({ q: r.query, imp: r.impressions });
  }
  for (const [url, arr] of perUrlQueries) {
    const top = [...arr].sort((a, b) => b.imp - a.imp).slice(0, 5).map((x) => x.q);
    urlTopQueries.set(url, new Set(top));
  }
  for (const [url, totals] of urlTotals) {
    if (totals.impressions < 100) continue;
    const myQs = urlTopQueries.get(url);
    if (!myQs || myQs.size === 0) continue;
    let overlapsAny = false;
    for (const [other, otherQs] of urlTopQueries) {
      if (other === url) continue;
      for (const q of myQs) {
        if (otherQs.has(q)) { overlapsAny = true; break; }
      }
      if (overlapsAny) break;
    }
    if (!overlapsAny) {
      // Pick an obvious donor: the highest-clicks URL on the site.
      let donorUrl: string | null = null;
      let donorClicks = -1;
      for (const [u, t] of urlTotals) {
        if (u === url) continue;
        if (t.clicks > donorClicks) { donorClicks = t.clicks; donorUrl = u; }
      }
      if (donorUrl) {
        opps.push({
          source_url: donorUrl,
          target_url: url,
          reason: 'orphan_gsc',
          relationship: 'network:orphan',
          priority: totals.impressions >= 1000 ? 'high' : 'normal',
          confidence: 'low',
          evidence: {
            orphan_url_impressions_28d: totals.impressions,
            orphan_url_clicks_28d: totals.clicks,
            top_queries: [...myQs].slice(0, 5),
          },
        });
      }
    }
  }

  // --- Upsert -----------------------------------------------------
  //
  // One-shot upsert using the (site_id, source_url, target_url, reason)
  // unique constraint. For PokePrices we see ~900 opportunities per
  // run; the per-row select+insert loop took ~240s. A single
  // chunked upsert takes ~1s.
  //
  // Returning the opportunity id lets us tell "newly inserted"
  // apart from "updated" by comparing first_seen_at vs now.
  const now = new Date().toISOString();
  if (opps.length === 0) return { generated: 0, updated: 0 };

  const uniqueKey = new Set<string>();
  const dedupOpps = opps.filter((o) => {
    const k = `${o.source_url}|${o.target_url}|${o.reason}`;
    if (uniqueKey.has(k)) return false;
    uniqueKey.add(k); return true;
  });

  const rows = dedupOpps.map((o) => ({
    site_id: siteId,
    source_url: o.source_url,
    target_url: o.target_url,
    reason: o.reason,
    relationship: o.relationship,
    priority: o.priority,
    confidence: o.confidence,
    evidence: o.evidence,
    last_seen_at: now,
  }));

  const CHUNK = 500;
  let totalBeforeIds = 0;
  // First get the set of existing ids so we can tell apart generated vs updated.
  const { data: existingRows } = await sb
    .from('network_internal_link_opportunities')
    .select('id, source_url, target_url, reason')
    .eq('site_id', siteId)
    .in('reason', [...new Set(dedupOpps.map((o) => o.reason))]);
  const existingKeys = new Set(((existingRows ?? []) as Array<{ source_url: string; target_url: string; reason: string }>)
    .map((r) => `${r.source_url}|${r.target_url}|${r.reason}`));
  totalBeforeIds = existingKeys.size;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await sb.from('network_internal_link_opportunities')
      .upsert(slice, { onConflict: 'site_id,source_url,target_url,reason' });
    if (error) throw new Error(`[internal-links] upsert: ${error.message}`);
  }
  let generated = 0;
  let updated = 0;
  for (const o of dedupOpps) {
    const k = `${o.source_url}|${o.target_url}|${o.reason}`;
    if (existingKeys.has(k)) updated++;
    else generated++;
  }
  void totalBeforeIds;
  return { generated, updated };
}
