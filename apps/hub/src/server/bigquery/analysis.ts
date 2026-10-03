import 'server-only';

// PokePrices deep SEO analysis via BigQuery.
//
// The CN service account has bigquery.jobUser + bigquery.dataViewer
// on `pokeprices-seo`. All queries run inside the Collector Network
// project (so quota + billing live there) but READ data from the
// external PokePrices project.
//
// We do NOT replicate the dataset into Supabase. We ONLY persist
// operational outputs:
//   • Query cannibalisation findings
//   • Content-gap signals
//   • Long-tail query clusters (reported into the brief; not stored)
//
// Cost discipline: every query has an explicit maximumBytesBilled
// cap and a partition filter on data_date (so BQ only scans the
// recent window, not the full table).
//
// Table of interest:
//   pokeprices-seo.searchconsole.searchdata_url_impression
//     schema: data_date DATE, site_url STRING, url STRING,
//             query STRING, country STRING, search_type STRING,
//             device STRING, impressions INT64, clicks INT64,
//             sum_position INT64, is_anonymized_query BOOL

import type { SupabaseClient } from '@supabase/supabase-js';
import { bqQuery } from '../google/bigquery';

const DATASET = 'pokeprices-seo.searchconsole.searchdata_url_impression';

interface CannibalRow {
  query: string;
  url_count: number;
  total_impressions: number;
  total_clicks: number;
  urls_json: string;
}
interface GapRow {
  query: string;
  url: string;
  impressions_28d: number;
  clicks_28d: number;
  avg_position: number;
  position_7d: number | null;
  impressions_7d: number;
}

export interface BqAnalysisStats {
  bytesProcessed: number;
  bytesBilled: number;
  queries: number;
  cannibalFindings: number;
  gapFindings: number;
}

/**
 * Compute cannibalisation findings for PokePrices.
 *
 * Cannibalisation = a single query where >1 URL on the SAME site
 * receives material impressions over the trailing 28 days. We only
 * flag queries that:
 *   • have >= 200 impressions total
 *   • have >= 2 URLs each with >= 15% of total impressions
 *   • filter out anonymised queries
 */
async function runCannibalisationQuery(): Promise<{ rows: CannibalRow[]; bytesProcessed: number; bytesBilled: number }> {
  const sql = `
    WITH recent AS (
      SELECT query, url, SUM(impressions) AS impr, SUM(clicks) AS clicks,
             CASE WHEN SUM(impressions) > 0 THEN SUM(sum_position) / SUM(impressions) ELSE NULL END AS avg_pos
        FROM \`${DATASET}\`
       WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
         AND NOT is_anonymized_query
         AND search_type = 'WEB'
       GROUP BY query, url
    ),
    qtot AS (
      SELECT query, SUM(impr) AS total_impr, SUM(clicks) AS total_clicks
        FROM recent
       GROUP BY query
       HAVING SUM(impr) >= 200
    ),
    participants AS (
      SELECT r.query, r.url, r.impr, r.clicks, r.avg_pos, q.total_impr, q.total_clicks
        FROM recent r JOIN qtot q USING(query)
       WHERE SAFE_DIVIDE(r.impr, q.total_impr) >= 0.15
    ),
    agg AS (
      SELECT query, total_impr, total_clicks, COUNT(*) AS url_count,
             ARRAY_AGG(STRUCT(url, impr, clicks, avg_pos) ORDER BY impr DESC LIMIT 10) AS urls
        FROM participants
       GROUP BY query, total_impr, total_clicks
       HAVING url_count >= 2
    )
    SELECT query, url_count, total_impr AS total_impressions,
           total_clicks AS total_clicks,
           TO_JSON_STRING(urls) AS urls_json
      FROM agg
     ORDER BY total_impr DESC
     LIMIT 500
  `;
  const r = await bqQuery<CannibalRow>(sql, { maximumBytesBilledMb: 1024, timeoutMs: 60000 });
  return { rows: r.rows, bytesProcessed: r.totalBytesProcessed, bytesBilled: r.totalBytesBilled };
}

/**
 * Compute content-gap findings for PokePrices.
 *
 * Content gap = query that has notable impressions on the site but
 * the ranking page is a weak match (ranking page is the homepage
 * or a hub page, not a dedicated page) OR impressions are growing
 * over the last 7 days vs the prior 21.
 *
 * We detect:
 *   • queries with ≥500 28d impressions where the ranking URL
 *     path has depth <= 1 (likely a hub, not a specific page)
 *   • queries where recent 7d impressions exceed 60% of 28d
 *     (growing demand)
 */
async function runContentGapQuery(): Promise<{ rows: GapRow[]; bytesProcessed: number; bytesBilled: number }> {
  const sql = `
    WITH recent AS (
      SELECT query, url, SUM(impressions) AS impr28, SUM(clicks) AS clicks28,
             CASE WHEN SUM(impressions) > 0 THEN SUM(sum_position) / SUM(impressions) ELSE NULL END AS avg_pos
        FROM \`${DATASET}\`
       WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
         AND NOT is_anonymized_query
         AND search_type = 'WEB'
       GROUP BY query, url
    ),
    recent7 AS (
      SELECT query, url, SUM(impressions) AS impr7,
             CASE WHEN SUM(impressions) > 0 THEN SUM(sum_position) / SUM(impressions) ELSE NULL END AS pos7
        FROM \`${DATASET}\`
       WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
         AND NOT is_anonymized_query
         AND search_type = 'WEB'
       GROUP BY query, url
    ),
    joined AS (
      SELECT r.query, r.url, r.impr28 AS impressions_28d, r.clicks28 AS clicks_28d,
             r.avg_pos AS avg_position, r7.pos7 AS position_7d,
             COALESCE(r7.impr7, 0) AS impressions_7d
        FROM recent r
   LEFT JOIN recent7 r7 ON r7.query = r.query AND r7.url = r.url
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY query ORDER BY impressions_28d DESC) AS rn
        FROM joined
    )
    SELECT query, url, impressions_28d, clicks_28d, avg_position,
           position_7d, impressions_7d
      FROM ranked
     WHERE rn = 1
       AND impressions_28d >= 500
       AND (
         -- depth 0 or 1 path (homepage, hub, category root)
         ARRAY_LENGTH(SPLIT(NET.REG_DOMAIN(url), '')) >= 1
         AND (
           ARRAY_LENGTH(SPLIT(REGEXP_REPLACE(url, r'^https?://[^/]+', ''), '/')) <= 2
           OR SAFE_DIVIDE(impressions_7d, impressions_28d) > 0.6
         )
       )
     ORDER BY impressions_28d DESC
     LIMIT 500
  `;
  const r = await bqQuery<GapRow>(sql, { maximumBytesBilledMb: 1024, timeoutMs: 60000 });
  return { rows: r.rows, bytesProcessed: r.totalBytesProcessed, bytesBilled: r.totalBytesBilled };
}

export async function runPokepricesBqAnalysis(
  sb: SupabaseClient,
  siteId: string,
): Promise<BqAnalysisStats> {
  let bytesProcessed = 0;
  let bytesBilled = 0;
  let queries = 0;
  let cannibalFindings = 0;
  let gapFindings = 0;

  // --- Cannibalisation --------------------------------------------
  const c = await runCannibalisationQuery();
  bytesProcessed += c.bytesProcessed;
  bytesBilled += c.bytesBilled;
  queries++;
  const now = new Date().toISOString();
  for (const row of c.rows) {
    const urls = JSON.parse(row.urls_json) as Array<{ url: string; impr: number; clicks: number; avg_pos: number }>;
    const severity: 'critical' | 'high' | 'normal' | 'low' =
      row.total_impressions >= 10000 ? 'high' :
      row.total_impressions >= 2000 ? 'normal' : 'low';
    const { data: existing } = await sb
      .from('network_cannibalization_findings')
      .select('id')
      .eq('site_id', siteId)
      .eq('query', row.query)
      .maybeSingle();
    const rowPayload = {
      site_id: siteId,
      query: row.query,
      url_count: Number(row.url_count),
      total_impressions: Number(row.total_impressions),
      total_clicks: Number(row.total_clicks),
      urls,
      severity,
      last_seen_at: now,
    };
    if (!existing) {
      const { error } = await sb.from('network_cannibalization_findings').insert(rowPayload);
      if (!error) cannibalFindings++;
    } else {
      await sb.from('network_cannibalization_findings')
        .update(rowPayload)
        .eq('id', (existing as { id: string }).id);
    }
  }

  // --- Content gaps ------------------------------------------------
  const g = await runContentGapQuery();
  bytesProcessed += g.bytesProcessed;
  bytesBilled += g.bytesBilled;
  queries++;
  for (const row of g.rows) {
    const impr28 = Number(row.impressions_28d);
    const impr7  = Number(row.impressions_7d);
    const risingDemand = impr28 > 0 && (impr7 / impr28) > 0.6;
    const reason = risingDemand ? 'rising_demand' : 'weak_match';
    const severity: 'critical' | 'high' | 'normal' | 'low' =
      impr28 >= 10_000 ? 'high' :
      impr28 >= 2_000  ? 'normal' : 'low';
    const { data: existing } = await sb
      .from('network_content_gap_findings')
      .select('id')
      .eq('site_id', siteId)
      .eq('query', row.query)
      .maybeSingle();
    const rowPayload = {
      site_id: siteId,
      query: row.query,
      ranking_url: row.url,
      impressions_28d: impr28,
      clicks_28d: Number(row.clicks_28d),
      position_28d: row.avg_position,
      gap_reason: reason,
      evidence: { impressions_7d: impr7, position_7d: row.position_7d },
      severity,
      last_seen_at: now,
    };
    if (!existing) {
      const { error } = await sb.from('network_content_gap_findings').insert(rowPayload);
      if (!error) gapFindings++;
    } else {
      await sb.from('network_content_gap_findings')
        .update(rowPayload)
        .eq('id', (existing as { id: string }).id);
    }
  }

  return { bytesProcessed, bytesBilled, queries, cannibalFindings, gapFindings };
}

/** Verification probe for /admin/health. Confirms the WIF chain can
 *  (a) authenticate against BigQuery, (b) see the pokeprices-seo
 *  datasets, (c) execute a bounded aggregate query. */
export async function bigqueryDiagnostic(): Promise<{
  ok: boolean;
  datasetsVisible: string[];
  sampleRows: number;
  bytesProcessed: number;
  bytesBilled: number;
  error?: string;
}> {
  try {
    const { bqListDatasets } = await import('../google/bigquery');
    const dsets = await bqListDatasets('pokeprices-seo');
    const r = await bqQuery<{ rows_n: number }>(`
      SELECT COUNT(*) AS rows_n
        FROM \`${DATASET}\`
       WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
    `, { maximumBytesBilledMb: 100 });
    return {
      ok: true,
      datasetsVisible: dsets.map((d) => d.id).filter(Boolean),
      sampleRows: Number(r.rows[0]?.rows_n ?? 0),
      bytesProcessed: r.totalBytesProcessed,
      bytesBilled: r.totalBytesBilled,
    };
  } catch (err) {
    return {
      ok: false,
      datasetsVisible: [],
      sampleRows: 0,
      bytesProcessed: 0,
      bytesBilled: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
