import 'server-only';

// 365-day READ-ONLY dry run of the Impact Media Partner API.
//
// Fetches every Action and ActionUpdate in the trailing year, split
// into <=45-day windows (Impact's hard cap on ActionDateStart /
// ActionDateEnd). Paginates each window fully using the envelope's
// `@nextpageuri` signal, with a per-window safety cap and an overall
// safety cap so no response shape can produce an unbounded loop.
//
// Writes nothing to the ledger. Returns a structured report the admin
// page can render.
//
// Verdict rule — the run is `ready` iff:
//   * every requested window returned 2xx
//   * duplicate canonical Action.Ids after dedupe = 0
//   * every Action has Id, State, EventDate, Payout, Currency
//   * all observed State values are in a known vocabulary
//     (APPROVED, PENDING, LOCKED, PAID, REVERSED)
//   * neither safety cap was hit (would mean we didn't fetch all data)
//
// Otherwise `partial` (some data recovered) or `blocked` (fatal).

import { createImpactClient, type ImpactResponse } from './client';

const WINDOW_DAYS = 45;
const WINDOW_COUNT_TARGET_DAYS = 365;
const PAGE_SIZE = 500;
const PER_WINDOW_SAFETY_CAP = 10_000;    // single window hard limit
const OVERALL_SAFETY_CAP = 100_000;      // 365-day hard limit
const MAX_PAGES_PER_WINDOW = Math.ceil(PER_WINDOW_SAFETY_CAP / PAGE_SIZE) + 2;

const KNOWN_STATES = ['APPROVED', 'PENDING', 'LOCKED', 'PAID', 'REVERSED'] as const;
type KnownState = (typeof KNOWN_STATES)[number];
const KNOWN_STATE_SET = new Set<string>(KNOWN_STATES);

// Raw records are capped to keep the server-component serialization
// under control. 10k ≈ 2–3 MB JSON — enough for the current 452-row
// account and plenty of headroom for the coverage + attribution audits.
const RAW_CAP = 10_000;

export interface WindowResult {
  index: number;                            // 0 = newest
  start_date: string;                       // YYYY-MM-DD inclusive
  end_date: string;                         // YYYY-MM-DD inclusive
  status: 'ok' | 'partial' | 'failed';
  error: string | null;
  actions_pages: number;
  actions_fetched: number;
  actions_total_reported: number | null;    // from envelope @total if present
  action_updates_pages: number;
  action_updates_fetched: number;
  action_updates_total_reported: number | null;
  duration_ms: number;
  per_window_safety_cap_hit: boolean;
}

export interface MonthRow {
  month: string;                            // YYYY-MM
  count: number;
  pending: number;
  approved: number;
  locked: number;
  paid: number;
  reversed: number;
  other: number;
  // Per-currency totals so a mixed-currency month is still readable.
  payout_minor_by_currency: Record<string, number>;
  amount_minor_by_currency: Record<string, number>;
}

export interface CurrencyRow {
  currency: string;
  count: number;
  payout_minor: number;
  amount_minor: number;
}

export interface MinimalAction {
  id: string | null;
  event_date: string | null;
  state: string | null;
  payout_minor: number | null;
  amount_minor: number | null;
  currency: string | null;
  campaign_id: string | null;
  sub_id_1: string | null;
  sub_id_2: string | null;
  sub_id_3: string | null;
  sub_id_4: string | null;
  shared_id: string | null;
  oid: string | null;
  order_id: string | null;
}

export interface MinimalActionUpdate {
  action_id: string | null;              // links back to Action.Id
  old_state: string | null;
  new_state: string | null;
  old_payout_minor: number | null;
  new_payout_minor: number | null;
  old_amount_minor: number | null;
  new_amount_minor: number | null;
  update_date: string | null;
  currency: string | null;
}

export interface StateCurrencyPayout {
  state: string;                         // PENDING / APPROVED / LOCKED / PAID / REVERSED / other
  currency: string;
  count: number;
  payout_minor: number;                  // current Payout from live Actions
  amount_minor: number;                  // current gross sale Amount
}

export interface AttributionField {
  field: 'SubId1' | 'SubId2' | 'SubId3' | 'SubId4' | 'SharedId';
  populated: number;
  distinct_count: number;
  top_values: Array<{ value: string; count: number }>;
}

export interface ReversedValueByCurrency {
  currency: string;
  reversed_action_count: number;         // Actions currently in REVERSED state
  current_payout_minor: number;          // sum of current Payout on REVERSED (should be 0)
  pre_reversal_payout_minor: number;     // sum of OldPayout from ActionUpdates that transitioned to REVERSED
  pre_reversal_source_update_count: number;
}

export interface DryRunReport {
  ran_at: string;
  skipped_reason: string | null;
  // Window metadata
  window_days: number;
  window_count: number;
  windows: WindowResult[];
  // Aggregates
  total_api_calls: number;
  actions_fetched_raw: number;
  action_updates_fetched_raw: number;
  distinct_action_ids: number;
  duplicate_action_ids: number;
  // Breakdowns
  by_state: Record<string, number>;
  by_currency: CurrencyRow[];
  by_month: MonthRow[];
  // Field integrity (counts of raw fetched Actions missing a critical field)
  missing_action_id: number;
  missing_state: number;
  missing_event_date: number;
  missing_payout: number;
  missing_currency: number;
  // State vocabulary
  known_states: readonly string[];
  unknown_states: string[];
  // Attribution
  with_sub_id_1: number;
  without_sub_id_1: number;
  distinct_sub_id_1_values: string[];
  // Coverage
  oldest_event_date: string | null;
  newest_event_date: string | null;
  // Safety caps
  per_window_safety_cap: number;
  overall_safety_cap: number;
  overall_safety_cap_hit: boolean;
  // Verdict
  verdict: 'ready' | 'partial' | 'blocked';
  blocking_reasons: string[];
  warnings: string[];
  // Raw access for downstream audits (coverage, attribution, reversal)
  raw_cap: number;
  raw_truncated: boolean;
  raw_actions: MinimalAction[];
  raw_action_updates: MinimalActionUpdate[];
  // Richer accounting breakdowns computed from the raw data
  state_currency_payout: StateCurrencyPayout[];
  attribution_fields: AttributionField[];
  reversed_value_by_currency: ReversedValueByCurrency[];
}

// ───────────────────────── helpers ─────────────────────────

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function dateIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function dateTimeIso(d: Date): string {
  return `${dateIso(d)}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`;
}

function pickRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['Actions', 'ActionUpdates', 'Records', 'Items']) {
      const v = d[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function envelopeOf(resp: ImpactResponse): Record<string, unknown> {
  return resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)
    ? (resp.data as Record<string, unknown>)
    : {};
}

function parseTotal(env: Record<string, unknown>): number | null {
  for (const k of ['@total', 'Total', 'TotalResults', '@numrecords']) {
    const v = env[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasNextPage(env: Record<string, unknown>): boolean | null {
  for (const k of ['@nextpageuri', 'NextPageUri', '@nextpage']) {
    if (k in env) {
      const v = env[k];
      return !(v == null || v === '');
    }
  }
  return null;
}

function toMinor(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const minor = Math.round(n * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function dateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

function monthOf(ymd: string | null): string | null {
  if (!ymd) return null;
  return ymd.slice(0, 7);
}

function strOrNull(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

function extractMinimalAction(r: Record<string, unknown>): MinimalAction {
  const dt = (r['EventDate'] ?? r['ActionDate']) as string | null;
  return {
    id:            strOrNull(r['Id']),
    event_date:    dateOnly(dt ?? null),
    state:         strOrNull(r['State']),
    payout_minor:  toMinor(r['Payout']),
    amount_minor:  toMinor(r['Amount']),
    currency:      strOrNull(r['Currency']),
    campaign_id:   strOrNull(r['CampaignId']),
    sub_id_1:      strOrNull(r['SubId1']),
    sub_id_2:      strOrNull(r['SubId2']),
    sub_id_3:      strOrNull(r['SubId3']),
    sub_id_4:      strOrNull(r['SubId4']),
    shared_id:     strOrNull(r['SharedId']),
    oid:           strOrNull(r['Oid']),
    order_id:      strOrNull(r['OrderId']),
  };
}

function extractMinimalUpdate(r: Record<string, unknown>): MinimalActionUpdate {
  // Impact ActionUpdate fields vary slightly by endpoint. We accept
  // either ActionId or Id as the link back to the parent Action.
  const dt = (r['UpdateDate'] ?? r['CreationDate'] ?? r['Date']) as string | null;
  return {
    action_id:         strOrNull(r['ActionId'] ?? r['Id']),
    old_state:         strOrNull(r['OldState'] ?? r['OldStatus']),
    new_state:         strOrNull(r['NewState'] ?? r['State'] ?? r['NewStatus']),
    old_payout_minor:  toMinor(r['OldPayout']),
    new_payout_minor:  toMinor(r['NewPayout'] ?? r['Payout']),
    old_amount_minor:  toMinor(r['OldAmount']),
    new_amount_minor:  toMinor(r['NewAmount'] ?? r['Amount']),
    update_date:       dateOnly(dt ?? null),
    currency:          strOrNull(r['Currency']),
  };
}

// ───────────────────────── core fetchers ─────────────────────────

interface Paged {
  pages: number;
  records: Array<Record<string, unknown>>;
  totalReported: number | null;
  safetyCapHit: boolean;
  error: string | null;
}

async function paginate(
  client: ReturnType<typeof createImpactClient>,
  endpoint: string,
  baseParams: Record<string, string>,
  overallRemaining: number,
): Promise<Paged> {
  const records: Array<Record<string, unknown>> = [];
  let totalReported: number | null = null;
  let pages = 0;
  let safetyCapHit = false;
  let error: string | null = null;

  for (let page = 1; page <= MAX_PAGES_PER_WINDOW; page++) {
    const resp = await client.get(endpoint, {
      ...baseParams,
      PageSize: String(PAGE_SIZE),
      Page: String(page),
    });
    if (!resp.ok) {
      error = `page ${page} returned ${resp.status}: ${resp.errorMessage ?? 'error'}`;
      break;
    }
    pages += 1;
    const env = envelopeOf(resp);
    if (page === 1) totalReported = parseTotal(env);

    const batch = pickRecords(resp.data) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;

    for (const r of batch) {
      if (records.length >= PER_WINDOW_SAFETY_CAP || records.length >= overallRemaining) {
        safetyCapHit = true;
        break;
      }
      records.push(r);
    }
    if (safetyCapHit) break;

    const next = hasNextPage(env);
    if (next === false) break;
    if (next === null && batch.length < PAGE_SIZE) break;
    if (totalReported != null && records.length >= totalReported) break;
  }

  return { pages, records, totalReported, safetyCapHit, error };
}

// ───────────────────────── entry point ─────────────────────────

export async function runDryRun(): Promise<DryRunReport> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];
  const blockingReasons: string[] = [];

  // Credentials
  let client: ReturnType<typeof createImpactClient>;
  try {
    client = createImpactClient();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return emptyReport(ran_at, reason);
  }

  // Build the window plan — newest-first, each ≤ 45 days, covering ~365 days total.
  const now = new Date();
  const todayEndUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  const windows: Array<{ startDate: Date; endDate: Date }> = [];
  let remaining = WINDOW_COUNT_TARGET_DAYS;
  let anchor = new Date(todayEndUtc);
  while (remaining > 0) {
    const span = Math.min(WINDOW_DAYS, remaining);
    const endDate = new Date(anchor);
    const startDate = new Date(anchor.getTime() - (span - 1) * 86_400_000);
    startDate.setUTCHours(0, 0, 0, 0);
    windows.push({ startDate, endDate });
    anchor = new Date(startDate.getTime() - 86_400_000);
    anchor.setUTCHours(23, 59, 59, 0);
    remaining -= span;
  }

  // Collect
  const windowResults: WindowResult[] = [];
  const allActions: Array<Record<string, unknown>> = [];
  const allActionUpdates: Array<Record<string, unknown>> = [];
  let actionUpdatesTotal = 0;
  let totalApiCalls = 0;
  let overallSafetyCapHit = false;
  let rawTruncated = false;

  for (let i = 0; i < windows.length; i++) {
    const win = windows[i];
    if (!win) continue;
    const { startDate, endDate } = win;
    const start = dateIso(startDate);
    const end = dateIso(endDate);
    const t0 = Date.now();

    const actionsRemaining = Math.max(0, OVERALL_SAFETY_CAP - allActions.length);
    const actionsP = await paginate(client, '/Actions', {
      ActionDateStart: dateTimeIso(startDate),
      ActionDateEnd: dateTimeIso(endDate),
    }, actionsRemaining);
    totalApiCalls += actionsP.pages;

    const updatesP = await paginate(client, '/ActionUpdates', {
      StartDate: dateTimeIso(startDate),
      EndDate: dateTimeIso(endDate),
    }, PER_WINDOW_SAFETY_CAP);
    totalApiCalls += updatesP.pages;

    const windowError = actionsP.error ?? updatesP.error ?? null;
    const windowStatus: WindowResult['status'] =
      actionsP.error && updatesP.error ? 'failed'
        : actionsP.error || updatesP.error ? 'partial'
        : 'ok';

    for (const r of actionsP.records) {
      if (allActions.length >= OVERALL_SAFETY_CAP) {
        overallSafetyCapHit = true;
        break;
      }
      allActions.push(r);
    }
    for (const r of updatesP.records) {
      if (allActionUpdates.length >= OVERALL_SAFETY_CAP) break;
      allActionUpdates.push(r);
    }
    actionUpdatesTotal += updatesP.records.length;

    windowResults.push({
      index: i,
      start_date: start,
      end_date: end,
      status: windowStatus,
      error: windowError,
      actions_pages: actionsP.pages,
      actions_fetched: actionsP.records.length,
      actions_total_reported: actionsP.totalReported,
      action_updates_pages: updatesP.pages,
      action_updates_fetched: updatesP.records.length,
      action_updates_total_reported: updatesP.totalReported,
      duration_ms: Date.now() - t0,
      per_window_safety_cap_hit: actionsP.safetyCapHit || updatesP.safetyCapHit,
    });

    if (overallSafetyCapHit) {
      warnings.push(`Hit the ${OVERALL_SAFETY_CAP.toLocaleString()}-Action overall safety cap in window ${i + 1}. Remaining windows were not fetched.`);
      break;
    }
  }

  // ── Analyse ──────────────────────────────────────────────────
  const byState: Record<string, number> = {};
  const byCurrencyMap = new Map<string, { count: number; payout: number; amount: number }>();
  const byMonth = new Map<string, MonthRow>();
  const seenIds = new Set<string>();
  const dupIds = new Set<string>();
  const subId1Set = new Set<string>();

  let missingId = 0, missingState = 0, missingDate = 0, missingPayout = 0, missingCurrency = 0;
  let withSub1 = 0;
  let oldestYmd: string | null = null;
  let newestYmd: string | null = null;

  const unknownStateSet = new Set<string>();

  for (const r of allActions) {
    const id = r['Id'] != null ? String(r['Id']) : null;
    const state = r['State'] != null ? String(r['State']) : null;
    const eventIso = (r['EventDate'] ?? r['ActionDate']) as string | null;
    const ymd = dateOnly(eventIso ?? null);
    const payoutMinor = toMinor(r['Payout']);
    const amountMinor = toMinor(r['Amount']);
    const currency = r['Currency'] != null ? String(r['Currency']) : null;
    const sub1 = r['SubId1'] != null ? String(r['SubId1']) : null;

    if (!id) missingId += 1;
    if (!state) missingState += 1;
    if (!ymd) missingDate += 1;
    if (payoutMinor == null) missingPayout += 1;
    if (!currency) missingCurrency += 1;

    if (id) {
      if (seenIds.has(id)) dupIds.add(id);
      else seenIds.add(id);
    }
    if (ymd) {
      if (!oldestYmd || ymd < oldestYmd) oldestYmd = ymd;
      if (!newestYmd || ymd > newestYmd) newestYmd = ymd;
    }
    if (state) {
      byState[state] = (byState[state] ?? 0) + 1;
      if (!KNOWN_STATE_SET.has(state)) unknownStateSet.add(state);
    }
    if (currency) {
      const cur = byCurrencyMap.get(currency) ?? { count: 0, payout: 0, amount: 0 };
      cur.count += 1;
      if (payoutMinor != null) cur.payout += payoutMinor;
      if (amountMinor != null) cur.amount += amountMinor;
      byCurrencyMap.set(currency, cur);
    }
    if (sub1) { withSub1 += 1; subId1Set.add(sub1); }

    // Monthly
    const month = monthOf(ymd);
    if (month) {
      let row = byMonth.get(month);
      if (!row) {
        row = {
          month,
          count: 0,
          pending: 0, approved: 0, locked: 0, paid: 0, reversed: 0, other: 0,
          payout_minor_by_currency: {},
          amount_minor_by_currency: {},
        };
        byMonth.set(month, row);
      }
      row.count += 1;
      const key = state ? (state.toLowerCase() as keyof MonthRow) : null;
      switch (state) {
        case 'PENDING':  row.pending += 1; break;
        case 'APPROVED': row.approved += 1; break;
        case 'LOCKED':   row.locked += 1; break;
        case 'PAID':     row.paid += 1; break;
        case 'REVERSED': row.reversed += 1; break;
        default:
          row.other += 1; break;
      }
      void key;
      if (currency) {
        if (payoutMinor != null) {
          row.payout_minor_by_currency[currency] =
            (row.payout_minor_by_currency[currency] ?? 0) + payoutMinor;
        }
        if (amountMinor != null) {
          row.amount_minor_by_currency[currency] =
            (row.amount_minor_by_currency[currency] ?? 0) + amountMinor;
        }
      }
    }
  }

  const byCurrency: CurrencyRow[] = Array.from(byCurrencyMap.entries())
    .map(([currency, v]) => ({
      currency,
      count: v.count,
      payout_minor: v.payout,
      amount_minor: v.amount,
    }))
    .sort((a, b) => b.count - a.count);

  const byMonthSorted = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

  // ── Raw record capture + enriched breakdowns ─────────────────
  const minimalActions: MinimalAction[] = [];
  for (const r of allActions) {
    if (minimalActions.length >= RAW_CAP) { rawTruncated = true; break; }
    minimalActions.push(extractMinimalAction(r));
  }
  const minimalUpdates: MinimalActionUpdate[] = [];
  for (const r of allActionUpdates) {
    if (minimalUpdates.length >= RAW_CAP) { rawTruncated = true; break; }
    minimalUpdates.push(extractMinimalUpdate(r));
  }

  // State × currency × payout breakdown — the accounting view.
  // Pending / approved / locked / paid / reversed must stay separate
  // in all downstream aggregations.
  const scpMap = new Map<string, StateCurrencyPayout>();
  for (const a of minimalActions) {
    const state = a.state ?? '(none)';
    const currency = a.currency ?? '(none)';
    const key = `${state}::${currency}`;
    const row = scpMap.get(key) ?? { state, currency, count: 0, payout_minor: 0, amount_minor: 0 };
    row.count += 1;
    if (a.payout_minor != null) row.payout_minor += a.payout_minor;
    if (a.amount_minor != null) row.amount_minor += a.amount_minor;
    scpMap.set(key, row);
  }
  const stateCurrencyPayout = Array.from(scpMap.values()).sort((x, y) => {
    const order = (s: string) => ['PENDING', 'APPROVED', 'LOCKED', 'PAID', 'REVERSED'].indexOf(s);
    const d = order(y.state) - order(x.state);
    return d !== 0 ? d : x.currency.localeCompare(y.currency);
  });

  // Attribution — frequency of each SubId / SharedId field with top values.
  const attributionFields: AttributionField[] = (['SubId1', 'SubId2', 'SubId3', 'SubId4', 'SharedId'] as const).map((field) => {
    const counts = new Map<string, number>();
    let populated = 0;
    for (const a of minimalActions) {
      const v =
        field === 'SubId1' ? a.sub_id_1 :
        field === 'SubId2' ? a.sub_id_2 :
        field === 'SubId3' ? a.sub_id_3 :
        field === 'SubId4' ? a.sub_id_4 :
        a.shared_id;
      if (!v) continue;
      populated += 1;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const top = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({ value, count }));
    return { field, populated, distinct_count: counts.size, top_values: top };
  });

  // Reversed value — current Action.Payout is 0 on REVERSED, so the
  // economic loss shows up only in ActionUpdates OldPayout where the
  // transition is INTO the REVERSED state. Sum OldPayout per currency.
  const reversedActionIds = new Set<string>();
  const revByCurrency = new Map<string, ReversedValueByCurrency>();
  for (const a of minimalActions) {
    if (a.state === 'REVERSED') {
      if (a.id) reversedActionIds.add(a.id);
      const cur = a.currency ?? '(none)';
      const row = revByCurrency.get(cur) ?? {
        currency: cur,
        reversed_action_count: 0,
        current_payout_minor: 0,
        pre_reversal_payout_minor: 0,
        pre_reversal_source_update_count: 0,
      };
      row.reversed_action_count += 1;
      if (a.payout_minor != null) row.current_payout_minor += a.payout_minor;
      revByCurrency.set(cur, row);
    }
  }
  for (const u of minimalUpdates) {
    if (u.new_state !== 'REVERSED') continue;
    if (u.old_payout_minor == null) continue;
    if (u.action_id && !reversedActionIds.has(u.action_id)) {
      // Update targets a non-REVERSED action — skip (stale state).
      continue;
    }
    const cur = u.currency ?? '(none)';
    const row = revByCurrency.get(cur) ?? {
      currency: cur,
      reversed_action_count: 0,
      current_payout_minor: 0,
      pre_reversal_payout_minor: 0,
      pre_reversal_source_update_count: 0,
    };
    row.pre_reversal_payout_minor += u.old_payout_minor;
    row.pre_reversal_source_update_count += 1;
    revByCurrency.set(cur, row);
  }
  const reversedValueByCurrency = Array.from(revByCurrency.values())
    .sort((a, b) => b.reversed_action_count - a.reversed_action_count);

  // ── Verdict ──────────────────────────────────────────────────
  const anyFailed = windowResults.some((w) => w.status === 'failed');
  const anyPartial = windowResults.some((w) => w.status === 'partial');
  const anyWindowCapHit = windowResults.some((w) => w.per_window_safety_cap_hit);
  const unknownStates = Array.from(unknownStateSet).sort();
  const totalFetched = allActions.length;
  const missingAnyCritical =
    missingId + missingState + missingDate + missingPayout + missingCurrency;

  if (anyFailed) blockingReasons.push(`${windowResults.filter((w) => w.status === 'failed').length} window(s) failed outright. See per-window errors.`);
  if (dupIds.size > 0) blockingReasons.push(`${dupIds.size} duplicate Action.Id value(s) across windows. Pagination overlap must be fixed before trusting these totals.`);
  if (missingAnyCritical > 0) blockingReasons.push(`${missingAnyCritical} field(s) missing on critical columns (Id / State / EventDate / Payout / Currency).`);
  if (unknownStates.length > 0) blockingReasons.push(`Unknown State value(s) observed: ${unknownStates.join(', ')}. Resolve semantics before rebuild.`);
  if (overallSafetyCapHit) blockingReasons.push(`Overall ${OVERALL_SAFETY_CAP.toLocaleString()}-Action safety cap hit — the 365-day window has more Actions than one dry run can capture.`);
  if (anyWindowCapHit) blockingReasons.push(`Per-window ${PER_WINDOW_SAFETY_CAP.toLocaleString()}-Action cap hit on at least one window.`);

  const verdict: DryRunReport['verdict'] =
    blockingReasons.length > 0 && (anyFailed || overallSafetyCapHit || dupIds.size > 0)
      ? 'blocked'
      : blockingReasons.length > 0 || anyPartial
      ? 'partial'
      : 'ready';

  return {
    ran_at,
    skipped_reason: null,
    window_days: WINDOW_DAYS,
    window_count: windows.length,
    windows: windowResults,
    total_api_calls: totalApiCalls,
    actions_fetched_raw: totalFetched,
    action_updates_fetched_raw: actionUpdatesTotal,
    distinct_action_ids: seenIds.size,
    duplicate_action_ids: dupIds.size,
    by_state: byState,
    by_currency: byCurrency,
    by_month: byMonthSorted,
    missing_action_id: missingId,
    missing_state: missingState,
    missing_event_date: missingDate,
    missing_payout: missingPayout,
    missing_currency: missingCurrency,
    known_states: KNOWN_STATES,
    unknown_states: unknownStates,
    with_sub_id_1: withSub1,
    without_sub_id_1: totalFetched - withSub1,
    distinct_sub_id_1_values: Array.from(subId1Set).sort().slice(0, 20),
    oldest_event_date: oldestYmd,
    newest_event_date: newestYmd,
    per_window_safety_cap: PER_WINDOW_SAFETY_CAP,
    overall_safety_cap: OVERALL_SAFETY_CAP,
    overall_safety_cap_hit: overallSafetyCapHit,
    verdict,
    blocking_reasons: blockingReasons,
    warnings,
    raw_cap: RAW_CAP,
    raw_truncated: rawTruncated,
    raw_actions: minimalActions,
    raw_action_updates: minimalUpdates,
    state_currency_payout: stateCurrencyPayout,
    attribution_fields: attributionFields,
    reversed_value_by_currency: reversedValueByCurrency,
  };
}

function emptyReport(ran_at: string, reason: string): DryRunReport {
  return {
    ran_at,
    skipped_reason: reason,
    window_days: WINDOW_DAYS,
    window_count: 0,
    windows: [],
    total_api_calls: 0,
    actions_fetched_raw: 0,
    action_updates_fetched_raw: 0,
    distinct_action_ids: 0,
    duplicate_action_ids: 0,
    by_state: {},
    by_currency: [],
    by_month: [],
    missing_action_id: 0,
    missing_state: 0,
    missing_event_date: 0,
    missing_payout: 0,
    missing_currency: 0,
    known_states: KNOWN_STATES,
    unknown_states: [],
    with_sub_id_1: 0,
    without_sub_id_1: 0,
    distinct_sub_id_1_values: [],
    oldest_event_date: null,
    newest_event_date: null,
    per_window_safety_cap: PER_WINDOW_SAFETY_CAP,
    overall_safety_cap: OVERALL_SAFETY_CAP,
    overall_safety_cap_hit: false,
    verdict: 'blocked',
    blocking_reasons: [reason],
    warnings: [reason],
    raw_cap: RAW_CAP,
    raw_truncated: false,
    raw_actions: [],
    raw_action_updates: [],
    state_currency_payout: [],
    attribution_fields: [],
    reversed_value_by_currency: [],
  };
}
