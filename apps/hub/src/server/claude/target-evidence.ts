import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TargetEvidenceForPrompt } from './action-prompt';

// CN-05 OS — target-level evidence loader.
//
// Reads network_gsc_url_daily and/or network_gsc_query_daily — both
// already ingested daily by /api/sync/gsc — to produce per-URL and
// per-query 28-day metrics for the prompt builder. Zero new API
// calls, zero new tables.
//
// Why this exists: the baseline carries SITE-WIDE numbers, but a
// page-targeted intervention should be evaluated against the TARGET
// URL's metrics, not the site total. The prompt builder renders this
// payload in its "Target-level evidence" section, clearly separated
// from the site baseline.

const WINDOW_DAYS = 28;

function iso(d: Date): string { return d.toISOString().slice(0, 10) }
function addDays(iso10: string, delta: number): string {
  const d = new Date(iso10 + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return iso(d);
}

async function latestGscDate(sb: SupabaseClient, siteId: string): Promise<string | null> {
  const { data } = await sb.from('network_gsc_url_daily')
    .select('date').eq('site_id', siteId)
    .order('date', { ascending: false }).limit(1).maybeSingle();
  return (data as { date: string } | null)?.date ?? null;
}

/** Normalise a target URL into the shape stored in network_gsc_url_daily.
 *  GSC rows carry the fully qualified absolute URL (with https:// prefix),
 *  but task evidence sometimes stores a bare path. We try both. */
function urlCandidates(target: string, siteDomain: string | null): string[] {
  const trimmed = target.trim();
  const set = new Set<string>();
  set.add(trimmed);
  if (trimmed.startsWith('/') && siteDomain) {
    set.add(`https://${siteDomain}${trimmed}`);
    set.add(`https://www.${siteDomain.replace(/^www\./, '')}${trimmed}`);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const u = new URL(trimmed);
    set.add(u.pathname + u.search);
  }
  return [...set];
}

export async function loadTargetEvidence(
  sb: SupabaseClient,
  args: {
    siteId: string;
    siteDomain: string | null;
    targetUrl: string | null;
    targetQuery: string | null;
  },
): Promise<TargetEvidenceForPrompt | null> {
  const notes: string[] = [];
  if (!args.targetUrl && !args.targetQuery) return null;
  const latest = await latestGscDate(sb, args.siteId);
  if (!latest) {
    notes.push('No GSC rows for this site yet — target-level evidence unavailable.');
    return {
      target_url: args.targetUrl, target_query: args.targetQuery,
      window: null, url_level: null, query_level: null,
      top_queries_for_url: null, notes,
    };
  }
  const windowEnd = latest;
  const windowStart = addDays(windowEnd, -(WINDOW_DAYS - 1));
  const result: TargetEvidenceForPrompt = {
    target_url: args.targetUrl, target_query: args.targetQuery,
    window: { start: windowStart, end: windowEnd },
    url_level: null, query_level: null, top_queries_for_url: null, notes,
  };

  // URL-level aggregate
  if (args.targetUrl) {
    const candidates = urlCandidates(args.targetUrl, args.siteDomain);
    const { data: urlRows, error: urlErr } = await sb
      .from('network_gsc_url_daily')
      .select('page, clicks, impressions, position_avg, date')
      .eq('site_id', args.siteId).gte('date', windowStart).lte('date', windowEnd)
      .in('page', candidates);
    if (urlErr) {
      notes.push(`URL-level GSC read error: ${urlErr.message} — URL metrics may be partial.`);
    } else {
      let imps = 0, clicks = 0, posWn = 0, posWd = 0, days = 0;
      for (const r of (urlRows ?? []) as Array<{ clicks: number; impressions: number; position_avg: number | null }>) {
        imps += r.impressions ?? 0;
        clicks += r.clicks ?? 0;
        if (r.position_avg != null) { posWn += (r.impressions ?? 0) * r.position_avg; posWd += (r.impressions ?? 0); }
        days++;
      }
      if (days > 0) {
        result.url_level = {
          impressions_28d: imps,
          clicks_28d: clicks,
          ctr_28d: imps > 0 ? clicks / imps : null,
          avg_position_28d: posWd > 0 ? posWn / posWd : null,
          days_with_data: days,
        };
      } else {
        notes.push(`No URL-level GSC rows found for target URL in the ${windowStart}→${windowEnd} window. The URL may be unindexed, below the GSC privacy threshold, or stored under a different canonical.`);
      }
    }
  }

  // Query-level aggregate
  if (args.targetQuery) {
    const { data: qRows, error: qErr } = await sb
      .from('network_gsc_query_daily')
      .select('clicks, impressions, position_avg, date')
      .eq('site_id', args.siteId).gte('date', windowStart).lte('date', windowEnd)
      .eq('query', args.targetQuery);
    if (qErr) {
      notes.push(`Query-level GSC read error: ${qErr.message}.`);
    } else {
      let imps = 0, clicks = 0, posWn = 0, posWd = 0, days = 0;
      for (const r of (qRows ?? []) as Array<{ clicks: number; impressions: number; position_avg: number | null }>) {
        imps += r.impressions ?? 0;
        clicks += r.clicks ?? 0;
        if (r.position_avg != null) { posWn += (r.impressions ?? 0) * r.position_avg; posWd += (r.impressions ?? 0); }
        days++;
      }
      if (days > 0) {
        result.query_level = {
          impressions_28d: imps,
          clicks_28d: clicks,
          ctr_28d: imps > 0 ? clicks / imps : null,
          avg_position_28d: posWd > 0 ? posWn / posWd : null,
          days_with_data: days,
        };
      } else {
        notes.push(`No query-level GSC rows found for \`${args.targetQuery}\` in the window.`);
      }
    }
  }

  // Top queries ranking for the target URL — useful for a striking-
  // distance investigation.
  // Note: network_gsc_query_daily is NOT joined to URL; GSC privacy
  // means we only have cross-site query aggregates. We can still
  // offer the site's top queries filtered to impressions > 0 to
  // surface candidate intent, but the brief says "ranking for this
  // URL". Skip when the detection rule didn't carry top_queries
  // already.
  // We DO carry them when the task's evidence (e.g. striking
  // distance rule) stored top_queries. The caller passes those
  // through directly; this helper doesn't re-fabricate them.

  return result;
}

/** Pull top_queries from the task/intel evidence (the striking
 *  distance rule stores them per-page). Returns null when the
 *  detection rule didn't include them — we never synthesise them. */
export function extractTopQueries(ev: Record<string, unknown> | null | undefined): TargetEvidenceForPrompt['top_queries_for_url'] {
  if (!ev) return null;
  const tq = (ev as { top_queries?: unknown }).top_queries;
  if (!Array.isArray(tq)) return null;
  const out: NonNullable<TargetEvidenceForPrompt['top_queries_for_url']> = [];
  for (const r of tq as Array<Record<string, unknown>>) {
    const query = typeof r.query === 'string' ? r.query : null;
    const imp = typeof r.impressions === 'number' ? r.impressions : null;
    const clk = typeof r.clicks === 'number' ? r.clicks : 0;
    const pos = typeof r.position === 'number' ? r.position : (typeof r.position_avg === 'number' ? r.position_avg : null);
    if (!query || imp == null) continue;
    out.push({ query, impressions: imp, clicks: clk, avg_position: pos });
  }
  return out.length > 0 ? out : null;
}
