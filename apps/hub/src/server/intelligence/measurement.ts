import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// CN-05 OS — intelligence measurement engine.
//
// Reads network_gsc_{site,url,query}_daily + network_ga4_site_daily
// (all pre-existing) and compares an action's post-change window to a
// matched-length pre-change window. Stores per-checkpoint results in
// network_tasks.metadata.measurement_checkpoints[]. No new tables.
// No new external data pipelines.
//
// Core principles the brief lays out:
//   * Anchor on operator-verified receipt completed_at (never prompt
//     generation, never baseline-freeze date).
//   * A D7 result compares 7 pre vs 7 post, not 7 vs 28.
//   * Account for GSC/GA4 reporting lag — never substitute zero.
//   * Capture each checkpoint once; subsequent cron runs are no-ops.
//   * Keep baseline immutable.
//   * Distinguish observed_improvement / observed_decline /
//     inconclusive / insufficient_data / measurement_pending.
//   * Never claim proven causation from a single before/after.

export const CHECKPOINTS = [7, 14, 28, 90] as const;
export type CheckpointDays = (typeof CHECKPOINTS)[number];
export const MEASUREMENT_VERSION = 'cn05-measure-v1';

// Reporting lag — days after a given calendar date before we treat
// that date's row as "settled". GSC finalises ~3d; GA4 ~2d. We use
// the stricter window.
export const SETTLE_LAG_DAYS = 3;

// Delta threshold under which we call the change "flat" instead of
// "up" or "down". 5% is loose enough to absorb normal daily noise
// while keeping genuinely small moves classified as flat.
const FLAT_THRESHOLD_PCT = 5;

// Minimum impressions in BOTH windows for us to call a result at
// all. Below this we return insufficient_data regardless of delta.
const MIN_IMPS_FOR_CALL = 500;

export interface Window { start: string; end: string; days: number }

export interface MetricPair<T extends number | null = number | null> {
  pre: T;
  post: T;
  delta_abs: number | null;
  delta_pct: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
}

export interface Checkpoint {
  /** 7 | 14 | 28 | 90 — the "D" number. */
  checkpoint: CheckpointDays;
  /** Target calendar date the window must have fully elapsed on
   *  (anchor + Dd). We wait SETTLE_LAG_DAYS past this before measuring. */
  target_date: string;
  /** Timestamp of first attempt that succeeded. Null when pending. */
  measured_at: string | null;
  status: 'pending' | 'measured' | 'insufficient_data' | 'inconclusive';
  anchor_at: string;
  pre_window: Window | null;
  post_window: Window | null;
  gsc_site: {
    clicks: MetricPair;
    impressions: MetricPair;
    ctr: MetricPair;
    avg_position: MetricPair;
  } | null;
  ga4_site: {
    active_users: MetricPair;
    sessions: MetricPair;
  } | null;
  /** Site-level trend over the same windows, used to contextualise
   *  the action's result (did the whole site also move the same way?). */
  site_trend: {
    clicks: MetricPair;
    active_users: MetricPair;
  } | null;
  /** The receipt's primary_success_metric mapped to one of the pairs
   *  above (when the OS can resolve it). Falls back to GSC clicks. */
  primary: { metric: string; pair: MetricPair } | null;
  outcome: 'observed_improvement' | 'observed_decline' | 'inconclusive' | 'insufficient_data' | 'measurement_pending';
  notes: string[];
  measurement_version: typeof MEASUREMENT_VERSION;
}

export interface MeasurementSchedule {
  anchor_at: string;           // receipt.completed_at
  anchor_source: 'operator_confirmed_receipt';
  anchor_task_id: string;
  anchor_receipt_commit_sha: string | null;
  anchor_receipt_deployment_sha: string | null;
  primary_success_metric: string | null;
  scheduled_at: string;        // when the schedule was first laid down
  schedule_version: typeof MEASUREMENT_VERSION;
  target_dates: Record<`D${CheckpointDays}`, string>;
}

export function iso(d: Date): string { return d.toISOString().slice(0, 10) }
export function addDays(iso10: string, delta: number): string {
  const d = new Date(iso10 + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return iso(d);
}

/** Build a schedule from the receipt that just got operator-verified.
 *  Idempotent: callers should check if a schedule already exists and
 *  reuse the anchor_at to avoid moving the goalposts. */
export function buildSchedule(args: {
  taskId: string;
  anchorIsoTimestamp: string;        // receipt.completed_at (full ISO)
  primarySuccessMetric: string | null;
  commitSha: string | null;
  deploymentSha: string | null;
}): MeasurementSchedule {
  const anchorDate = args.anchorIsoTimestamp.slice(0, 10);
  const target_dates = Object.fromEntries(
    CHECKPOINTS.map((d) => [`D${d}` as const, addDays(anchorDate, d)]),
  ) as Record<`D${CheckpointDays}`, string>;
  return {
    anchor_at: args.anchorIsoTimestamp,
    anchor_source: 'operator_confirmed_receipt',
    anchor_task_id: args.taskId,
    anchor_receipt_commit_sha: args.commitSha,
    anchor_receipt_deployment_sha: args.deploymentSha,
    primary_success_metric: args.primarySuccessMetric,
    scheduled_at: new Date().toISOString(),
    schedule_version: MEASUREMENT_VERSION,
    target_dates,
  };
}

/** Pure helper — is this checkpoint eligible to be measured right now?
 *  Due = target_date + SETTLE_LAG_DAYS <= today. We don't start
 *  measuring until the reporting data has had time to settle. */
export function isCheckpointDue(targetDate: string, today: string, lagDays = SETTLE_LAG_DAYS): boolean {
  return addDays(targetDate, lagDays) <= today;
}

function pair(pre: number | null, post: number | null): MetricPair {
  const delta_abs = pre != null && post != null ? post - pre : null;
  const delta_pct = pre != null && post != null && pre > 0 ? ((post - pre) / pre) * 100 : null;
  let direction: MetricPair['direction'] = 'unknown';
  if (delta_pct != null) {
    if (Math.abs(delta_pct) < FLAT_THRESHOLD_PCT) direction = 'flat';
    else direction = delta_pct > 0 ? 'up' : 'down';
  } else if (pre != null && post != null) {
    // Pre is 0; post>0 or post=0.
    direction = post > 0 ? 'up' : 'flat';
  }
  return { pre, post, delta_abs, delta_pct, direction };
}

// ─────────────────────────── GSC + GA4 reads ──────────────────────────

async function readGscSite(sb: SupabaseClient, siteId: string, start: string, end: string): Promise<{
  clicks: number; impressions: number; days: number;
  position_avg: number | null; // impression-weighted
} | null> {
  const { data, error } = await sb.from('network_gsc_site_daily')
    .select('clicks, impressions, position_avg')
    .eq('site_id', siteId).gte('date', start).lte('date', end);
  if (error || !data) return null;
  let clicks = 0, imps = 0, posWn = 0, posWd = 0, days = 0;
  for (const r of data as Array<{ clicks: number; impressions: number; position_avg: number | null }>) {
    clicks += r.clicks ?? 0;
    imps += r.impressions ?? 0;
    if (r.position_avg != null) { posWn += (r.impressions ?? 0) * r.position_avg; posWd += r.impressions ?? 0; }
    days++;
  }
  return { clicks, impressions: imps, days, position_avg: posWd > 0 ? posWn / posWd : null };
}

async function readGa4Site(sb: SupabaseClient, siteId: string, start: string, end: string): Promise<{
  active_users: number; sessions: number; days: number;
} | null> {
  const { data, error } = await sb.from('network_ga4_site_daily')
    .select('active_users, sessions')
    .eq('site_id', siteId).gte('date', start).lte('date', end);
  if (error || !data) return null;
  let au = 0, sess = 0, days = 0;
  for (const r of data as Array<{ active_users: number; sessions: number }>) {
    au += r.active_users ?? 0; sess += r.sessions ?? 0; days++;
  }
  return { active_users: au, sessions: sess, days };
}

/** Latest-complete window END date for a measurement. Target date is
 *  the ideal end, but if reporting is still lagging we clip to the
 *  latest date that has data (never the future, never today). */
async function clipToSettledEnd(sb: SupabaseClient, siteId: string, ideal: string, today: string): Promise<string> {
  const settledCeiling = addDays(today, -SETTLE_LAG_DAYS);
  // ideal must not exceed settled ceiling
  const cap = ideal < settledCeiling ? ideal : settledCeiling;
  // Also must not exceed actual data; look up max date
  const { data } = await sb.from('network_gsc_site_daily')
    .select('date').eq('site_id', siteId).lte('date', cap)
    .order('date', { ascending: false }).limit(1).maybeSingle();
  return (data as { date: string } | null)?.date ?? cap;
}

// ───────────────────────────── Capture ─────────────────────────────

export interface CaptureInput {
  taskId: string;
  siteId: string | null;
  schedule: MeasurementSchedule;
  checkpoint: CheckpointDays;
  today: string;                    // injectable for tests
  primarySuccessMetric: string | null;
}

/** Capture a single checkpoint's measurement. Pure data flow: reads
 *  GSC + GA4 daily tables, computes pre/post pairs, returns a frozen
 *  Checkpoint object. The caller writes it into task metadata. */
export async function captureCheckpoint(
  sb: SupabaseClient,
  input: CaptureInput,
): Promise<Checkpoint> {
  const notes: string[] = [];
  const anchorDate = input.schedule.anchor_at.slice(0, 10);
  const dCount = input.checkpoint;
  const idealEnd = addDays(anchorDate, dCount);

  // Shell result in case of early exit.
  const base: Checkpoint = {
    checkpoint: dCount,
    target_date: idealEnd,
    measured_at: null,
    status: 'pending',
    anchor_at: input.schedule.anchor_at,
    pre_window: null, post_window: null,
    gsc_site: null, ga4_site: null, site_trend: null, primary: null,
    outcome: 'measurement_pending',
    notes,
    measurement_version: MEASUREMENT_VERSION,
  };

  if (!input.siteId) {
    base.status = 'insufficient_data';
    base.outcome = 'insufficient_data';
    notes.push('Task is network-scoped (no site_id). v1 measurement captures site-level metrics only.');
    base.measured_at = new Date().toISOString();
    return base;
  }

  if (!isCheckpointDue(idealEnd, input.today)) {
    notes.push(`Not yet due. Target end ${idealEnd} + ${SETTLE_LAG_DAYS}d settle lag > today ${input.today}.`);
    return base;
  }

  const settledPostEnd = await clipToSettledEnd(sb, input.siteId, idealEnd, input.today);
  if (settledPostEnd < anchorDate) {
    notes.push(`No settled post-change data yet (latest GSC date ${settledPostEnd} < anchor ${anchorDate}).`);
    return base;
  }

  // Post window: [anchor+1, settledPostEnd] clipped to <= dCount days.
  const postStart = addDays(anchorDate, 1);
  const postEnd = settledPostEnd;
  const postDays = Math.min(dCount, daysBetween(postStart, postEnd) + 1);
  const postEndClipped = addDays(postStart, postDays - 1);
  // Pre window: same length ending anchor_date-1.
  const preEnd = addDays(anchorDate, -1);
  const preStart = addDays(preEnd, -(postDays - 1));

  base.pre_window = { start: preStart, end: preEnd, days: postDays };
  base.post_window = { start: postStart, end: postEndClipped, days: postDays };

  // Reads.
  const [gscPre, gscPost, ga4Pre, ga4Post] = await Promise.all([
    readGscSite(sb, input.siteId, preStart, preEnd),
    readGscSite(sb, input.siteId, postStart, postEndClipped),
    readGa4Site(sb, input.siteId, preStart, preEnd),
    readGa4Site(sb, input.siteId, postStart, postEndClipped),
  ]);

  if (gscPre && gscPre.days < postDays) notes.push(`GSC pre-window partial: ${gscPre.days}/${postDays} days present.`);
  if (gscPost && gscPost.days < postDays) notes.push(`GSC post-window partial: ${gscPost.days}/${postDays} days present.`);
  if (ga4Pre && ga4Pre.days < postDays) notes.push(`GA4 pre-window partial: ${ga4Pre.days}/${postDays} days present.`);
  if (ga4Post && ga4Post.days < postDays) notes.push(`GA4 post-window partial: ${ga4Post.days}/${postDays} days present.`);

  // Build metric pairs. Null when source is missing (never zero-sub).
  const gsc_site = (gscPre && gscPost) ? {
    clicks: pair(gscPre.clicks, gscPost.clicks),
    impressions: pair(gscPre.impressions, gscPost.impressions),
    ctr: pair(
      gscPre.impressions > 0 ? gscPre.clicks / gscPre.impressions : null,
      gscPost.impressions > 0 ? gscPost.clicks / gscPost.impressions : null,
    ),
    avg_position: pair(gscPre.position_avg, gscPost.position_avg),
  } : null;
  const ga4_site = (ga4Pre && ga4Post) ? {
    active_users: pair(ga4Pre.active_users, ga4Post.active_users),
    sessions: pair(ga4Pre.sessions, ga4Post.sessions),
  } : null;
  base.gsc_site = gsc_site;
  base.ga4_site = ga4_site;

  // Site-level trend context (same windows, same site). For v1 this
  // IS gsc_site + ga4_site because the task is scoped to one site;
  // when per-page targets land, site_trend becomes a separate read.
  base.site_trend = (gsc_site && ga4_site) ? {
    clicks: gsc_site.clicks,
    active_users: ga4_site.active_users,
  } : null;

  // Primary metric selection from the receipt's primary_success_metric
  // string. We match by substring to be lenient — operators type
  // "GSC clicks", "organic clicks", "sessions", etc. Falls back to
  // GSC clicks when nothing matches but gsc_site exists.
  const pm = (input.primarySuccessMetric ?? '').toLowerCase();
  let primary: Checkpoint['primary'] = null;
  if (gsc_site) {
    if (/impression/.test(pm)) primary = { metric: 'gsc_impressions', pair: gsc_site.impressions };
    else if (/ctr/.test(pm)) primary = { metric: 'gsc_ctr', pair: gsc_site.ctr };
    else if (/position|rank/.test(pm)) primary = { metric: 'gsc_avg_position', pair: gsc_site.avg_position };
  }
  if (!primary && ga4_site) {
    if (/user|visitor|session/.test(pm)) primary = { metric: 'ga4_active_users', pair: ga4_site.active_users };
  }
  if (!primary && gsc_site) primary = { metric: 'gsc_clicks', pair: gsc_site.clicks };
  if (!primary && ga4_site) primary = { metric: 'ga4_sessions', pair: ga4_site.sessions };
  base.primary = primary;

  // Outcome classification. Rules (deterministic, no AI):
  //   * No gsc or ga4 at all → insufficient_data.
  //   * Impressions in BOTH windows below MIN_IMPS_FOR_CALL →
  //     insufficient_data (nothing to say).
  //   * Primary direction = up and > FLAT_THRESHOLD_PCT →
  //     observed_improvement. 'down' + >threshold → observed_decline.
  //   * Else inconclusive.
  //
  // We do NOT credit site-wide tailwinds. A primary improvement that
  // merely tracks overall traffic growth is still an observed_improvement
  // on the raw numbers, but the UI will display the site_trend
  // alongside so the operator can judge attribution.

  const hasAnyData = !!(gsc_site || ga4_site);
  if (!hasAnyData) {
    base.status = 'insufficient_data';
    base.outcome = 'insufficient_data';
    notes.push('No GSC or GA4 rows found for either window — nothing to compare.');
  } else {
    const impsPre = gsc_site?.impressions.pre ?? 0;
    const impsPost = gsc_site?.impressions.post ?? 0;
    const totalImps = (impsPre ?? 0) + (impsPost ?? 0);
    if (gsc_site && totalImps < MIN_IMPS_FOR_CALL) {
      base.status = 'insufficient_data';
      base.outcome = 'insufficient_data';
      notes.push(`Combined impressions (${totalImps}) under threshold ${MIN_IMPS_FOR_CALL}; no call made.`);
    } else if (!primary || primary.pair.direction === 'unknown') {
      base.status = 'inconclusive';
      base.outcome = 'inconclusive';
      notes.push('Primary metric could not be scored (pre and/or post missing).');
    } else if (primary.pair.direction === 'up' && (primary.pair.delta_pct ?? 0) >= FLAT_THRESHOLD_PCT) {
      // avg_position is "lower is better" — flip the semantics.
      if (primary.metric === 'gsc_avg_position') {
        base.status = 'measured'; base.outcome = 'observed_decline';
        notes.push('avg_position increased (ranking worsened).');
      } else {
        base.status = 'measured'; base.outcome = 'observed_improvement';
      }
    } else if (primary.pair.direction === 'down' && Math.abs(primary.pair.delta_pct ?? 0) >= FLAT_THRESHOLD_PCT) {
      if (primary.metric === 'gsc_avg_position') {
        base.status = 'measured'; base.outcome = 'observed_improvement';
        notes.push('avg_position decreased (ranking improved).');
      } else {
        base.status = 'measured'; base.outcome = 'observed_decline';
      }
    } else {
      base.status = 'measured'; base.outcome = 'inconclusive';
      notes.push(`Primary delta ${(primary.pair.delta_pct ?? 0).toFixed(1)}% within ±${FLAT_THRESHOLD_PCT}% flat band.`);
    }
  }

  base.measured_at = new Date().toISOString();
  // Causation disclaimer — kept in every result so the UI can't drop it.
  notes.push('Observed change only. Correlation ≠ causation; the baseline window is a reference, not a controlled counterfactual.');
  return base;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Overall workflow state derivable from task metadata. The Inbox
 *  reads this to render the right chip. */
export type MeasurementState =
  | 'not_eligible'
  | 'awaiting_verification'
  | 'scheduled'
  | 'in_progress'
  | 'complete';

export function deriveMeasurementState(meta: Record<string, unknown> | null): MeasurementState {
  const m = meta ?? {};
  const receipts = Array.isArray((m as { implementation_receipts?: unknown[] }).implementation_receipts)
    ? (m as { implementation_receipts: Array<{ operator_confirmed_at?: string | null }> }).implementation_receipts
    : [];
  if (receipts.length === 0) return 'not_eligible';
  const latest = receipts[0];
  if (!latest?.operator_confirmed_at) return 'awaiting_verification';
  const schedule = (m as { measurement_schedule?: MeasurementSchedule }).measurement_schedule ?? null;
  const checkpoints = (m as { measurement_checkpoints?: Checkpoint[] }).measurement_checkpoints ?? [];
  if (!schedule) return 'awaiting_verification';
  const measuredCount = checkpoints.filter((c) => c.status === 'measured' || c.status === 'inconclusive' || c.status === 'insufficient_data').length;
  if (measuredCount >= CHECKPOINTS.length) return 'complete';
  if (measuredCount > 0) return 'in_progress';
  return 'scheduled';
}

/** Deterministic concise summary string of the current measurement
 *  state — used by the inbox + the task row. */
export function summariseOutcome(checkpoints: Checkpoint[] | null | undefined): string {
  const list = (checkpoints ?? []).slice().sort((a, b) => a.checkpoint - b.checkpoint);
  if (list.length === 0) return 'no measurements yet';
  const parts: string[] = [];
  for (const c of list) {
    const d = `D${c.checkpoint}`;
    if (c.status === 'pending') { parts.push(`${d}: pending`); continue; }
    const o = c.outcome.replace(/_/g, ' ');
    const pct = c.primary?.pair.delta_pct;
    if (pct != null) parts.push(`${d}: ${o} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}% ${c.primary?.metric})`);
    else parts.push(`${d}: ${o}`);
  }
  return parts.join(' · ');
}
