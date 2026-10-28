import 'server-only';

// CN-05 OS — opportunity relevance assessment.
//
// Pure deterministic heuristics over the Intelligence evidence + task
// context. Zero AI calls, zero DB reads. The output feeds into the
// prompt builder so Claude is told whether to treat the recommendation
// as actionable, suspect, or already-stale BEFORE it reads any code.
//
// Design principles:
//   * Conservative. We never silently delete a finding; we flag it
//     for Claude to decide.
//   * No speculation from URL patterns alone. A URL that *looks*
//     like an event only triggers the flag when a resolvable past
//     date is present AND an event-sounding token appears.
//   * Deterministic. Same input → same verdict + same reasons.

export type RelevanceVerdict =
  | 'actionable'               // high confidence this is worth investigating
  | 'needs_investigation'      // plausible but confidence < 60 or ambiguous
  | 'potentially_stale'        // evidence or target may no longer apply
  | 'not_actionable'           // strong signal the opportunity is dead
  | 'insufficient_evidence';   // thin data — Claude should default to NO CHANGE

export type OpportunityType =
  | 'striking_distance_seo'
  | 'indexing_issue'
  | 'affiliate_conversion'
  | 'content_gap'
  | 'site_wide_technical'
  | 'commercial_outreach'
  | 'generic_seo'
  | 'other';

export interface RelevanceAssessment {
  verdict: RelevanceVerdict;
  opportunity_type: OpportunityType;
  reasons: string[];
  signals: {
    last_detected_days_ago: number | null;
    target_url: string | null;
    target_query: string | null;
    impressions_28d: number | null;
    clicks_28d: number | null;
    weighted_position: number | null;
    confidence_score: number | null;
    priority_score: number | null;
    page_type_hint: 'event' | 'card' | 'set' | 'article' | 'index' | 'other';
    event_date_hint: { month_year: string; is_in_past: boolean } | null;
  };
}

interface AssessInput {
  task: {
    task_type: string;
    task_kind: 'fix' | 'improvement';
    evidence: Record<string, unknown>;
  };
  intel: {
    category: string;
    type: string | null;
    recommended_action: string | null;
    evidence: Record<string, unknown>;
    confidence_score: number | null;
    priority_score: number | null;
    last_detected_at: string | null;
  } | null;
  /** Server-injectable so tests can pin a specific "today". */
  today?: Date;
}

/** Classify the opportunity into one of a small, enumerated set so
 *  the prompt builder can pick the matching investigation checklist.
 *  Pure deterministic lookup. */
export function classifyOpportunityType(input: AssessInput): OpportunityType {
  const tt = (input.task.task_type ?? '').toLowerCase();
  const cat = (input.intel?.category ?? '').toLowerCase();
  const type = (input.intel?.type ?? '').toLowerCase();
  const rec = (input.intel?.recommended_action ?? '').toLowerCase();

  // Prefer the most-specific signal. Intel.type carries the detection
  // rule name (e.g. 'striking-distance', 'indexing-page-opp').
  if (type.includes('striking')) return 'striking_distance_seo';
  if (type.includes('index') || cat === 'indexing') return 'indexing_issue';
  if (cat === 'revenue' || cat === 'monetisation' || /affiliate|outbound|commission/.test(rec)) {
    return 'affiliate_conversion';
  }
  if (type.includes('content-gap') || cat === 'content') return 'content_gap';
  if (type.includes('technical') || cat === 'technical' || cat === 'data_health') return 'site_wide_technical';
  if (tt === 'commercial') return 'commercial_outreach';
  if (cat === 'seo' || cat === 'growth') return 'generic_seo';
  return 'other';
}

/** Rough page-type sniff. Only inspects URL path + query string. */
function pageTypeHint(url: string | null): RelevanceAssessment['signals']['page_type_hint'] {
  if (!url) return 'other';
  const u = url.toLowerCase();
  if (/\/(set|sets)\/[^/]+\/(card|cards)\//.test(u)) return 'card';
  if (/\/pokemon\/[^/]+$/.test(u)) return 'card';         // pokeprices species page
  if (/\/(set|sets)\/[^/]+\/?$/.test(u)) return 'set';
  if (/\/(insights|blog|news|articles|guides|guide)\//.test(u)) return 'article';
  if (/\/(event|events|convention|conventions|show|shows|tournament)\//.test(u)) return 'event';
  if (/\/$/.test(u) || /\/(set|sets|cards|browse)\/?$/.test(u)) return 'index';
  return 'other';
}

/** Detect a probable "event date" encoded in URL + title. Returns the
 *  earliest convincingly-past month-year token found, or null.
 *  Conservative: a bare "2026" alone is NOT treated as a date. */
function detectEventDate(url: string | null, title: string | null, today: Date): RelevanceAssessment['signals']['event_date_hint'] {
  const subject = `${url ?? ''} ${title ?? ''}`.toLowerCase();
  // Only trigger when the text contains an event-sounding word AND a
  // month+year token. Avoids false positives on card URLs like
  // 'base-set-1999-shadowless-charizard'.
  const hasEventWord = /\b(show|event|con|convention|tournament|release|expo|fair|meet(up)?)\b/.test(subject);
  if (!hasEventWord) return null;

  const monthMap: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  // "oct 2026" / "october-2026" / "oct-26" (2-digit) / "2026-10" (ISO-ish)
  const monthToken = /(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*/;
  const lookup = (name: string | undefined): number | null => {
    if (!name) return null;
    const n = monthMap[name as keyof typeof monthMap];
    return typeof n === 'number' ? n : null;
  };
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => { month: number; year: number } | null]> = [
    [new RegExp(`\\b${monthToken.source}[\\s_\\-]+(\\d{4})\\b`), (m) => { const month = lookup(m[1]); return month ? { month, year: Number(m[2]) } : null; }],
    [new RegExp(`\\b(\\d{4})[\\s_\\-]${monthToken.source}`), (m) => { const month = lookup(m[2]); return month ? { month, year: Number(m[1]) } : null; }],
    [new RegExp(`\\b${monthToken.source}[\\s_\\-]+(\\d{2})\\b`), (m) => { const month = lookup(m[1]); return month ? { month, year: Number(m[2]) + 2000 } : null; }],
    [/\b(\d{4})-(0[1-9]|1[0-2])\b/, (m) => ({ month: Number(m[2]), year: Number(m[1]) })],
  ];
  for (const [re, pick] of patterns) {
    const m = subject.match(re);
    if (m) {
      const picked = pick(m);
      if (!picked || !picked.month) continue;
      const { month, year } = picked;
      if (year < 2000 || year > 2100) continue;
      // Compare year+month only — day isn't reliable from URL text.
      const todayY = today.getUTCFullYear();
      const todayM = today.getUTCMonth() + 1;
      const isInPast = year < todayY || (year === todayY && month < todayM);
      return {
        month_year: `${year}-${String(month).padStart(2, '0')}`,
        is_in_past: isInPast,
      };
    }
  }
  return null;
}

/** Pull target_url / target_query / impressions / clicks / position
 *  from the mixed evidence shape produced by the detection rules. */
function extractSignals(input: AssessInput): {
  target_url: string | null; target_query: string | null;
  impressions_28d: number | null; clicks_28d: number | null;
  weighted_position: number | null;
} {
  const bags = [input.task.evidence ?? {}, input.intel?.evidence ?? {}, (input.task.evidence as { upstream_evidence?: Record<string, unknown> } | null)?.upstream_evidence ?? {}];
  let target_url: string | null = null;
  let target_query: string | null = null;
  let impressions_28d: number | null = null;
  let clicks_28d: number | null = null;
  let weighted_position: number | null = null;
  for (const bag of bags) {
    const b = bag as Record<string, unknown>;
    for (const k of ['target_url', 'url', 'page', 'target_page', 'affected_page']) {
      const v = b[k];
      if (!target_url && typeof v === 'string' && v.trim()) target_url = v.trim();
    }
    for (const k of ['target_query', 'query', 'top_query']) {
      const v = b[k];
      if (!target_query && typeof v === 'string' && v.trim()) target_query = v.trim();
    }
    for (const k of ['impressions_28d', 'total_impressions_28d', 'total_impressions', 'impressions']) {
      const v = b[k];
      if (impressions_28d == null && typeof v === 'number') impressions_28d = v;
    }
    for (const k of ['clicks_28d', 'total_clicks_28d', 'total_clicks', 'clicks']) {
      const v = b[k];
      if (clicks_28d == null && typeof v === 'number') clicks_28d = v;
    }
    for (const k of ['weighted_position', 'position_avg', 'avg_position', 'position']) {
      const v = b[k];
      if (weighted_position == null && typeof v === 'number') weighted_position = v;
    }
    // top_queries array fallback → sum of impressions/clicks when the
    // detection rule stored them per-query instead of as a single total.
    const tq = (b as { top_queries?: unknown }).top_queries;
    if (Array.isArray(tq)) {
      let impSum = 0, clkSum = 0, hasData = false;
      for (const r of tq as Array<Record<string, unknown>>) {
        const imp = r?.['impressions']; const clk = r?.['clicks'];
        if (typeof imp === 'number') { impSum += imp; hasData = true; }
        if (typeof clk === 'number') { clkSum += clk; }
      }
      if (hasData) {
        if (impressions_28d == null) impressions_28d = impSum;
        if (clicks_28d == null) clicks_28d = clkSum;
      }
    }
  }
  return { target_url, target_query, impressions_28d, clicks_28d, weighted_position };
}

const MIN_IMPRESSIONS_FOR_ACTION = 100;
const STALE_DAYS = 14;

export function assessRelevance(input: AssessInput): RelevanceAssessment {
  const today = input.today ?? new Date();
  const type = classifyOpportunityType(input);
  const sig = extractSignals(input);
  const page_type_hint = pageTypeHint(sig.target_url);
  const event_hint = detectEventDate(sig.target_url, (input.intel?.recommended_action ?? '') + ' ' + (sig.target_url ?? ''), today);
  const last = input.intel?.last_detected_at ? new Date(input.intel.last_detected_at) : null;
  const days_ago = last ? Math.floor((today.getTime() - last.getTime()) / 86400000) : null;

  const reasons: string[] = [];
  let verdict: RelevanceVerdict = 'actionable';

  // Hard flags that drop us straight to not_actionable or stale:
  if (event_hint && event_hint.is_in_past) {
    verdict = 'potentially_stale';
    reasons.push(`Target appears to reference an event in ${event_hint.month_year}, which is in the past relative to ${today.toISOString().slice(0, 10)}. Verify current relevance before any change.`);
  }

  // Insufficient impressions / signal
  if (sig.impressions_28d != null && sig.impressions_28d < MIN_IMPRESSIONS_FOR_ACTION) {
    verdict = 'insufficient_evidence';
    reasons.push(`Only ${sig.impressions_28d} impressions in the detection window — below the ${MIN_IMPRESSIONS_FOR_ACTION}-impression floor for a committed intervention. Default to NO CHANGE unless investigation reveals a stronger reason.`);
  }

  // Staleness (last detected too long ago)
  if (days_ago != null && days_ago > STALE_DAYS) {
    if (verdict === 'actionable') verdict = 'potentially_stale';
    reasons.push(`Last detected ${days_ago} days ago (threshold: ${STALE_DAYS}d). Re-check whether the issue still shows in the latest reporting window.`);
  }

  // Low confidence from the scoring engine
  if (input.intel?.confidence_score != null && input.intel.confidence_score < 50) {
    if (verdict === 'actionable') verdict = 'needs_investigation';
    reasons.push(`Detection confidence is ${input.intel.confidence_score}/100 (<50). Treat as hypothesis, not confirmed fact.`);
  }

  // Low priority combined with weak signal
  if (
    input.intel?.priority_score != null && input.intel.priority_score < 45
    && sig.impressions_28d != null && sig.impressions_28d < 500
  ) {
    if (verdict === 'actionable') verdict = 'needs_investigation';
    reasons.push(`Priority score ${input.intel.priority_score}/100 combined with low impressions suggests this may be too marginal to justify a change.`);
  }

  // If no reasons gathered the verdict stays 'actionable'.
  if (reasons.length === 0) reasons.push('No disqualifying signals detected — opportunity passes the OS relevance checks.');

  return {
    verdict,
    opportunity_type: type,
    reasons,
    signals: {
      last_detected_days_ago: days_ago,
      target_url: sig.target_url,
      target_query: sig.target_query,
      impressions_28d: sig.impressions_28d,
      clicks_28d: sig.clicks_28d,
      weighted_position: sig.weighted_position,
      confidence_score: input.intel?.confidence_score ?? null,
      priority_score: input.intel?.priority_score ?? null,
      page_type_hint,
      event_date_hint: event_hint,
    },
  };
}
