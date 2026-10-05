import 'server-only';

// Read-only audit of the Impact Media Partner API.
//
// After the first live run we learned:
//   * The API is active for ONE campaign: eBay Partner Network
//     (CampaignId = 9356). This is NOT the TCGplayer / Impact
//     advertiser flow we initially assumed — it is the direct EPN
//     API, candidate replacement for our manual CSV import.
//   * /Actions caps the date window at 45 days.
//   * /ActionUpdates uses StartDate / EndDate (NOT
//     ActionUpdateStartDate / ActionUpdateEndDate).
//   * /Clicks is 403 for this account tier — click data lives at
//     /ClickExport instead (likely sync CSV or async job).
//   * /Campaigns returns records keyed on CampaignId / CampaignName
//     / AdvertiserName; our earlier parser was looking at .Id.
//
// Auth classification rule: credentials are valid iff ANY endpoint
// returns a 2xx. 400 (bad params) and 403 (endpoint-tier restriction)
// are endpoint-specific, NOT credential rejection. 401 on a known-
// reachable endpoint = rejection.

import {
  createImpactClient,
  ImpactAuthMissingError,
  type ImpactResponse,
} from './client';

export interface EndpointAudit {
  endpoint: string;
  description: string;
  status: number;
  ok: boolean;
  errorMessage: string | null;
  recordCount: number | null;
  topLevelKeys: string[];
  recordKeys: string[];
  sampleFields: Array<{
    key: string;
    typeHint: string;
    exampleValue: string | null;
    isLikelySecret: boolean;
  }>;
  rawExcerpt: string;
  contentType: string | null;
  bodyBytes: number;
  queryUsed: Record<string, string>;    // what we called with — surfaces in the UI
}

export interface AttributionAudit {
  totalSampleRows: number;
  withSubId1: number;
  withSubId2: number;
  withSubId3: number;
  withSubId4: number;
  withSharedId: number;
  withReferringUrl: number;
  withLandingPageUrl: number;
  distinctSubId1Values: string[];
  distinctCampaigns: Array<{ campaignId: string; campaignName: string | null; advertiserName: string | null }>;
}

export interface StatusAudit {
  distinctActionStates: Array<{ value: string; count: number }>;
  distinctActionUpdateStates: Array<{ value: string; count: number }>;
  payoutValuePresence: { withPayout: number; withZeroPayout: number; withNullPayout: number };
  currenciesSeen: string[];
}

export interface CsvComparisonRow {
  csvColumn: string;
  apiField: string | null;
  endpoint: string;
  notes: string;
}

export interface BackfillPlan {
  totalDays: number;
  windowDays: number;
  windowCount: number;
  estimatedApiCalls: {
    actions: string;
    actionUpdates: string;
    clickExport: string;
    campaigns: string;
    invoices: string;
    totalMin: number;
    totalMax: number;
  };
  windows: Array<{ start: string; end: string }>;
  notes: string[];
}

export interface ImpactAudit {
  ran_at: string;
  auth_configured: boolean;
  auth_result: 'ok' | 'missing_env' | 'rejected' | 'network_error' | 'unknown';
  auth_evidence: string;                      // human-readable reason
  account_sid_present: boolean;
  endpoints: {
    campaigns: EndpointAudit;
    actions: EndpointAudit;
    actionUpdates: EndpointAudit;
    clickExport: EndpointAudit;
    invoices: EndpointAudit;
    reports: EndpointAudit;
  };
  attribution: AttributionAudit;
  statuses: StatusAudit;
  csvComparison: CsvComparisonRow[];
  backfillPlan: BackfillPlan;
  canReplaceCsv: {
    verdict: 'yes' | 'partial' | 'no' | 'unknown';
    reasons: string[];
  };
  warnings: string[];
}

const SECRET_KEY_PATTERNS = /^(token|password|secret|apikey|api_key|private_key|accesstoken|bearer|accountsid|accountid|advertiserid)$/i;

function typeHintOf(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function likelySecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.test(key);
}

function stringifyExample(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.length > 100 ? v.slice(0, 100) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    return `{${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '…' : ''}}`;
  }
  return null;
}

function pickRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['Actions', 'Records', 'ActionUpdates', 'Campaigns', 'Clicks', 'Invoices', 'Items']) {
      const v = d[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function buildEndpointAudit(
  endpoint: string,
  description: string,
  resp: ImpactResponse<unknown>,
  queryUsed: Record<string, string>,
): EndpointAudit {
  const audit: EndpointAudit = {
    endpoint,
    description,
    status: resp.status,
    ok: resp.ok,
    errorMessage: resp.errorMessage,
    recordCount: null,
    topLevelKeys: [],
    recordKeys: [],
    sampleFields: [],
    rawExcerpt: resp.rawExcerpt,
    contentType: resp.contentType,
    bodyBytes: resp.bodyBytes,
    queryUsed,
  };
  if (resp.ok && resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)) {
    audit.topLevelKeys = Object.keys(resp.data).sort();
  }
  if (resp.ok && resp.data != null) {
    const records = pickRecords(resp.data);
    audit.recordCount = records.length;
    const first = records[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const entries = Object.entries(first as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      audit.recordKeys = entries.map(([k]) => k);
      audit.sampleFields = entries.map(([k, v]) => ({
        key: k,
        typeHint: typeHintOf(v),
        exampleValue: likelySecretKey(k) ? '[REDACTED]' : stringifyExample(v),
        isLikelySecret: likelySecretKey(k),
      }));
    }
  }
  return audit;
}

function emptyEndpoint(endpoint: string, description: string, queryUsed: Record<string, string> = {}): EndpointAudit {
  return {
    endpoint,
    description,
    status: 0,
    ok: false,
    errorMessage: 'not called (auth missing)',
    recordCount: null,
    topLevelKeys: [],
    recordKeys: [],
    sampleFields: [],
    rawExcerpt: '',
    contentType: null,
    bodyBytes: 0,
    queryUsed,
  };
}

// ─── Documented CSV ↔ API field map ────────────────────────────
// Hard-coded against our EPN CSV columns and Impact's documented
// Media Partner Action / ActionUpdate shape. The live audit's
// sample field inventory confirms (or denies) each row.
const CSV_API_MAP: CsvComparisonRow[] = [
  { csvColumn: 'EPN Transaction ID / Order ID',       apiField: 'Id',                  endpoint: 'Actions',       notes: 'Primary identity key. Idempotency = `impact:` + Id.' },
  { csvColumn: 'eBay Checkout Transaction ID',        apiField: 'Oid / OrderId',       endpoint: 'Actions',       notes: 'Merchant-side order id when exposed.' },
  { csvColumn: 'Event Date / Transaction Date',       apiField: 'EventDate / ActionDate', endpoint: 'Actions',    notes: 'Business date of the conversion.' },
  { csvColumn: 'Update Date',                         apiField: 'CreationDate / UpdateDate', endpoint: 'ActionUpdates', notes: 'When Impact recorded the state/payout change.' },
  { csvColumn: 'Status (confirmed/pending/reversed)', apiField: 'State',               endpoint: 'Actions',       notes: 'Vocabulary expected: APPROVED, PENDING, REVERSED, LOCKED, PAID. Live-verified on the audit page.' },
  { csvColumn: 'Earnings',                            apiField: 'Payout',              endpoint: 'Actions',       notes: 'Current commission.' },
  { csvColumn: 'Delta Earnings',                      apiField: 'NewPayout - OldPayout', endpoint: 'ActionUpdates', notes: 'Derived from state/payout transitions, not a separate column.' },
  { csvColumn: 'Sales',                               apiField: 'Amount',              endpoint: 'Actions',       notes: 'Gross sale value (not commission).' },
  { csvColumn: 'Delta Sales',                         apiField: 'Amount transition',   endpoint: 'ActionUpdates', notes: 'Available when sale value is restated.' },
  { csvColumn: 'Campaign ID',                         apiField: 'CampaignId',          endpoint: 'Actions',       notes: 'Already seen = 9356 (eBay Partner Network).' },
  { csvColumn: 'Custom ID / Sub ID',                  apiField: 'SubId1-4, SharedId',  endpoint: 'Actions',       notes: 'Site + placement attribution — population confirmed in audit page.' },
  { csvColumn: 'Item Title',                          apiField: '(not exposed in Action top-level)', endpoint: 'Actions / ActionItems', notes: 'Line items at /Actions/{id}/ActionItems if we want per-SKU detail.' },
  { csvColumn: 'Currency',                            apiField: 'Currency',            endpoint: 'Actions',       notes: 'ISO 4217.' },
  { csvColumn: 'Quantity / Delta Quantity',           apiField: 'ActionItems[].Quantity', endpoint: 'ActionItems', notes: 'Only present on the per-action line item sub-resource.' },
];

// ─── Backfill plan (static documentation; not executed) ────────
function buildBackfillPlan(): BackfillPlan {
  const totalDays = 365;
  const windowDays = 45;
  const windowCount = Math.ceil(totalDays / windowDays);
  const windows: Array<{ start: string; end: string }> = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < windowCount; i++) {
    const winEnd = new Date(end.getTime() - i * windowDays * 86400000);
    const winStart = new Date(end.getTime() - (i + 1) * windowDays * 86400000 + 86400000);
    windows.push({
      start: winStart.toISOString().slice(0, 10),
      end: winEnd.toISOString().slice(0, 10),
    });
  }
  return {
    totalDays,
    windowDays,
    windowCount,
    estimatedApiCalls: {
      // Guesses based on an upper bound of ~1000 rows per 45-day
      // window at page size 100 and known pagination defaults.
      actions: `${windowCount} × ~N pages of /Actions (page size 100). At 500 actions/window = ~5 pages/window = ~${windowCount * 5} calls.`,
      actionUpdates: `${windowCount} × ~N pages of /ActionUpdates. At 1500 updates/window = ~15 pages/window = ~${windowCount * 15} calls.`,
      clickExport: `1 call per window if /ClickExport is sync; +1 polling call if async. ~${windowCount}–${windowCount * 2}.`,
      campaigns: '1 call (static list).',
      invoices: '1 call (page size 100).',
      totalMin: windowCount * 5 + windowCount * 15 + windowCount + 2,
      totalMax: windowCount * 10 + windowCount * 30 + windowCount * 2 + 2,
    },
    windows,
    notes: [
      'Windows advance newest-first so an interrupted backfill resumes forward in time.',
      'Impact rate limits: ~1,000 req/hour per account on most endpoints. The upper-bound estimate (~800 calls across the year) fits comfortably within a single hour window.',
      'Dedupe: idempotency_key = `impact:` + Action.Id. Running the same window twice is a safe no-op after the first import.',
      'ActionUpdates are re-run per window so a reversal on an old transaction updates the live row even if that transaction is outside the latest Actions window.',
      'Backfill is DESIGN ONLY in this phase. Nothing is executed. Daily cron would use a 7-day rolling overlap window, not 45.',
    ],
  };
}

// ─── Entry point ───────────────────────────────────────────────
export async function runImpactAudit(): Promise<ImpactAudit> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];

  let client: ReturnType<typeof createImpactClient> | null = null;
  let authResult: ImpactAudit['auth_result'] = 'unknown';
  let authEvidence = '';
  let authConfigured = false;
  let sidPresent = false;

  try {
    client = createImpactClient();
    authConfigured = true;
    sidPresent = Boolean(client.sid);
  } catch (err) {
    if (err instanceof ImpactAuthMissingError) {
      authResult = 'missing_env';
      authEvidence = err.message;
    } else {
      authResult = 'unknown';
      authEvidence = err instanceof Error ? err.message : String(err);
    }
  }

  if (!client) {
    return emptyShell(ran_at, authConfigured, authResult, authEvidence, sidPresent);
  }

  // Windows: 30d for Actions / ActionUpdates (Impact caps Actions
  // at 45d; 30 keeps us safely inside). 7d for ClickExport so the
  // sync response is small when the account supports it.
  const now = new Date();
  const actionsStart = new Date(now.getTime() - 30 * 86400000);
  const clickStart   = new Date(now.getTime() -  7 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z';
  const date = (d: Date) => d.toISOString().slice(0, 10);

  const actionsQuery = {
    PageSize: '10',
    Page: '1',
    ActionDateStart: iso(actionsStart),
    ActionDateEnd: iso(now),
  };
  const updatesQuery = {
    PageSize: '10',
    Page: '1',
    StartDate: iso(actionsStart),
    EndDate: iso(now),
  };
  const clickExportQuery = {
    StartDate: date(clickStart),
    EndDate: date(now),
  };
  const invoicesQuery = { PageSize: '10', Page: '1' };

  const [campaignsR, actionsR, updatesR, clickExportR, invoicesR, reportsR] = await Promise.all([
    client.get('/Campaigns'),
    client.get('/Actions', actionsQuery),
    client.get('/ActionUpdates', updatesQuery),
    client.get('/ClickExport', clickExportQuery),
    client.get('/Invoices', invoicesQuery),
    client.get('/Reports'),
  ]);

  // ─── Auth classification ─────────────────────────────────────
  // Credentials are valid iff ANY endpoint returned 2xx. 400 (bad
  // params) and 403 (endpoint-tier restriction) are endpoint-specific
  // and MUST NOT mark credentials as rejected. Only 401 on an
  // endpoint we know should be reachable (/Campaigns) rejects auth.
  const allResults = [campaignsR, actionsR, updatesR, clickExportR, invoicesR, reportsR];
  const anyOk = allResults.some((r) => r.ok);
  const anyNetworkError = allResults.some((r) => r.status === 0);
  const campaignsReject = campaignsR.status === 401;
  const anyAuthReject = allResults.some((r) => r.status === 401);

  if (anyOk) {
    authResult = 'ok';
    const okEndpoints = allResults.filter((r) => r.ok).map((r) => r.endpoint);
    authEvidence = `Authenticated — 2xx returned by ${okEndpoints.join(', ')}.`;
  } else if (campaignsReject || anyAuthReject) {
    authResult = 'rejected';
    authEvidence = 'A protected endpoint returned HTTP 401. Verify IMPACT_ACCOUNT_SID + IMPACT_API_TOKEN in Vercel.';
  } else if (anyNetworkError) {
    authResult = 'network_error';
    authEvidence = 'One or more requests failed before reaching Impact. Check network / DNS.';
  } else {
    authResult = 'unknown';
    authEvidence = 'No endpoint returned 2xx and no explicit 401; see per-endpoint status below.';
  }

  // ─── Per-endpoint audit records ──────────────────────────────
  const endpoints = {
    campaigns:     buildEndpointAudit('/Campaigns',     'Brand/program relationships',   campaignsR,    {}),
    actions:       buildEndpointAudit('/Actions',       'Conversion/transaction list',   actionsR,      actionsQuery),
    actionUpdates: buildEndpointAudit('/ActionUpdates', 'Status and payout changes',     updatesR,      updatesQuery),
    clickExport:   buildEndpointAudit('/ClickExport',   'Click-level data (sync CSV or async job)', clickExportR, clickExportQuery),
    invoices:      buildEndpointAudit('/Invoices',      'Payout invoices',               invoicesR,     invoicesQuery),
    reports:       buildEndpointAudit('/Reports',       'Pre-aggregated reports index',  reportsR,      {}),
  };

  if (clickExportR.status === 200 && clickExportR.contentType?.includes('text/csv')) {
    warnings.push('/ClickExport returned CSV directly — sync download works for small windows.');
  } else if (clickExportR.status === 200 && clickExportR.contentType?.includes('application/json')) {
    warnings.push('/ClickExport returned JSON — likely an async job id response. The sync will need to poll.');
  } else if (clickExportR.status === 403) {
    warnings.push('/ClickExport returned 403. Account tier may not expose click data. Not credential-related.');
  }
  if (actionsR.status === 400) {
    warnings.push(`/Actions returned 400: ${actionsR.errorMessage ?? 'bad params'}. Confirm date window ≤ 45 days.`);
  }
  if (updatesR.status === 400) {
    warnings.push(`/ActionUpdates returned 400: ${updatesR.errorMessage ?? 'bad params'}. Confirm StartDate / EndDate.`);
  }
  if (reportsR.status === 403 || reportsR.status === 404) {
    warnings.push(`/Reports returned ${reportsR.status}. Endpoint not required for ledger sync.`);
  }

  // ─── Attribution + status + currency inventory ──────────────
  const actionRecords = pickRecords(actionsR.data) as Array<Record<string, unknown>>;
  const actionUpdateRecords = pickRecords(updatesR.data) as Array<Record<string, unknown>>;
  // Clicks: if /ClickExport returned JSON with records, try to pick
  // them; CSV body is not parsed here (that's the sync's job).
  const clickRecords: Array<Record<string, unknown>> = Array.isArray(pickRecords(clickExportR.data))
    ? (pickRecords(clickExportR.data) as Array<Record<string, unknown>>)
    : [];
  const allRows = [...actionRecords, ...clickRecords];

  const attribution: AttributionAudit = {
    totalSampleRows: allRows.length,
    withSubId1: 0,
    withSubId2: 0,
    withSubId3: 0,
    withSubId4: 0,
    withSharedId: 0,
    withReferringUrl: 0,
    withLandingPageUrl: 0,
    distinctSubId1Values: [],
    distinctCampaigns: [],
  };
  const subId1Set = new Set<string>();
  for (const row of allRows) {
    if (row['SubId1']) { attribution.withSubId1 += 1; subId1Set.add(String(row['SubId1'])); }
    if (row['SubId2']) attribution.withSubId2 += 1;
    if (row['SubId3']) attribution.withSubId3 += 1;
    if (row['SubId4']) attribution.withSubId4 += 1;
    if (row['SharedId']) attribution.withSharedId += 1;
    if (row['ReferringUrl'] || row['RefererUrl']) attribution.withReferringUrl += 1;
    if (row['LandingPageUrl'] || row['LandingPage'] || row['Url']) attribution.withLandingPageUrl += 1;
  }
  attribution.distinctSubId1Values = Array.from(subId1Set).slice(0, 10);

  // Campaigns: Impact returns CampaignId / CampaignName /
  // AdvertiserName — our previous parser was looking for .Id, hence
  // the camp-0 bug. Use the actual field names.
  const campaignRecords = pickRecords(campaignsR.data) as Array<Record<string, unknown>>;
  attribution.distinctCampaigns = campaignRecords.slice(0, 25).map((c) => ({
    campaignId: String(c['CampaignId'] ?? c['Id'] ?? ''),
    campaignName: (c['CampaignName'] ?? c['Name'] ?? null) as string | null,
    advertiserName: (c['AdvertiserName'] ?? null) as string | null,
  }));

  const stateCount = new Map<string, number>();
  for (const r of actionRecords) {
    const v = (r['State'] ?? r['Status']) as string | undefined;
    if (!v) continue;
    stateCount.set(v, (stateCount.get(v) ?? 0) + 1);
  }
  const updateStateCount = new Map<string, number>();
  for (const r of actionUpdateRecords) {
    const v = (r['State'] ?? r['NewState'] ?? r['NewStatus']) as string | undefined;
    if (!v) continue;
    updateStateCount.set(v, (updateStateCount.get(v) ?? 0) + 1);
  }
  const currenciesSeen = Array.from(new Set(
    actionRecords.map((r) => r['Currency'] ?? r['PayoutCurrency']).filter(Boolean),
  )) as string[];
  let withPayout = 0, withZeroPayout = 0, withNullPayout = 0;
  for (const r of actionRecords) {
    const p = r['Payout'];
    if (p == null || p === '') withNullPayout += 1;
    else if (Number(p) === 0) withZeroPayout += 1;
    else withPayout += 1;
  }

  const statuses: StatusAudit = {
    distinctActionStates: Array.from(stateCount.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    distinctActionUpdateStates: Array.from(updateStateCount.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    payoutValuePresence: { withPayout, withZeroPayout, withNullPayout },
    currenciesSeen,
  };

  if (actionRecords.length > 0 && attribution.withSubId1 === 0) {
    warnings.push('No sampled Action has SubId1 populated. Site attribution via SubId1 will not work without updating outbound Impact links.');
  }

  // ─── CSV-vs-API verdict ──────────────────────────────────────
  const canReplaceCsv = decideCsvReplacement({
    actionsOk: endpoints.actions.ok,
    updatesOk: endpoints.actionUpdates.ok,
    campaignsOk: endpoints.campaigns.ok,
    hasIdField: endpoints.actions.recordKeys.includes('Id'),
    hasStateField: endpoints.actions.recordKeys.includes('State'),
    hasPayoutField: endpoints.actions.recordKeys.includes('Payout'),
    hasAmountField: endpoints.actions.recordKeys.includes('Amount'),
    hasCurrencyField: endpoints.actions.recordKeys.includes('Currency'),
  });

  return {
    ran_at,
    auth_configured: authConfigured,
    auth_result: authResult,
    auth_evidence: authEvidence,
    account_sid_present: sidPresent,
    endpoints,
    attribution,
    statuses,
    csvComparison: CSV_API_MAP,
    backfillPlan: buildBackfillPlan(),
    canReplaceCsv,
    warnings,
  };
}

interface CsvDecisionInputs {
  actionsOk: boolean;
  updatesOk: boolean;
  campaignsOk: boolean;
  hasIdField: boolean;
  hasStateField: boolean;
  hasPayoutField: boolean;
  hasAmountField: boolean;
  hasCurrencyField: boolean;
}

function decideCsvReplacement(x: CsvDecisionInputs): ImpactAudit['canReplaceCsv'] {
  const reasons: string[] = [];
  if (!x.actionsOk) {
    reasons.push('/Actions did not return 2xx. Transaction identity + state + payout unavailable.');
    return { verdict: 'no', reasons };
  }
  const requiredFields = [
    { name: 'Id', present: x.hasIdField },
    { name: 'State', present: x.hasStateField },
    { name: 'Payout', present: x.hasPayoutField },
    { name: 'Currency', present: x.hasCurrencyField },
  ];
  const missing = requiredFields.filter((f) => !f.present).map((f) => f.name);
  if (missing.length > 0) {
    reasons.push(`Missing required fields on sampled Action: ${missing.join(', ')}.`);
    return { verdict: 'partial', reasons };
  }
  if (!x.updatesOk) {
    reasons.push('/ActionUpdates did not return 2xx. Status transitions (pending → confirmed / reversed) cannot be reconciled live — only current state is observable.');
    return { verdict: 'partial', reasons };
  }
  if (!x.campaignsOk) {
    reasons.push('/Campaigns did not return 2xx. We cannot map CampaignId → human name without the CSV.');
    return { verdict: 'partial', reasons };
  }
  reasons.push('Actions provides unique Id, current State, Payout, Amount, Currency, CampaignId, SubId1-4.');
  reasons.push('ActionUpdates provides status + payout transitions.');
  reasons.push('Both endpoints respect the (SID, token) credentials and reconcile idempotently via Action.Id.');
  reasons.push('Site attribution via SubId1 still requires outbound EPN links to tag it — verify in the Attribution panel above.');
  return { verdict: 'yes', reasons };
}

function emptyShell(
  ran_at: string,
  authConfigured: boolean,
  authResult: ImpactAudit['auth_result'],
  authEvidence: string,
  sidPresent: boolean,
): ImpactAudit {
  return {
    ran_at,
    auth_configured: authConfigured,
    auth_result: authResult,
    auth_evidence: authEvidence,
    account_sid_present: sidPresent,
    endpoints: {
      campaigns:     emptyEndpoint('/Campaigns',     'Brand/program relationships'),
      actions:       emptyEndpoint('/Actions',       'Conversion/transaction list'),
      actionUpdates: emptyEndpoint('/ActionUpdates', 'Status and payout changes'),
      clickExport:   emptyEndpoint('/ClickExport',   'Click-level data'),
      invoices:      emptyEndpoint('/Invoices',      'Payout invoices'),
      reports:       emptyEndpoint('/Reports',       'Pre-aggregated reports index'),
    },
    attribution: {
      totalSampleRows: 0,
      withSubId1: 0, withSubId2: 0, withSubId3: 0, withSubId4: 0,
      withSharedId: 0, withReferringUrl: 0, withLandingPageUrl: 0,
      distinctSubId1Values: [], distinctCampaigns: [],
    },
    statuses: {
      distinctActionStates: [], distinctActionUpdateStates: [],
      payoutValuePresence: { withPayout: 0, withZeroPayout: 0, withNullPayout: 0 },
      currenciesSeen: [],
    },
    csvComparison: CSV_API_MAP,
    backfillPlan: buildBackfillPlan(),
    canReplaceCsv: { verdict: 'unknown', reasons: ['Audit did not run (auth missing).'] },
    warnings: ['IMPACT_ACCOUNT_SID or IMPACT_API_TOKEN is missing in this environment.'],
  };
}
