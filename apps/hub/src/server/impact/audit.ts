import 'server-only';

// Read-only audit of the Impact Media Partner API. Pulls a small
// sample from each core endpoint and surfaces field-level inventory
// so the OS can propose a mapping to our existing ledger without
// guessing.
//
// Writes NOTHING to the production ledger. No AI calls. No logging
// of credentials. Burns ~6 API calls per run.

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
  topLevelKeys: string[];              // object keys at the top of the response
  recordKeys: string[];                // keys on the first record (sorted)
  sampleFields: Array<{
    key: string;
    typeHint: string;                   // 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined'
    exampleValue: string | null;        // sanitised/truncated example value
    isLikelySecret: boolean;            // defensive — redact anything that looks like a secret
  }>;
  rawExcerpt: string;                   // first 2 KB for human inspection
}

export interface AttributionAudit {
  // Audits SubId1-4 / SharedId / ReferringUrl population across the
  // sampled rows. Tells us whether site attribution is possible from
  // the data we already receive.
  totalSampleRows: number;
  withSubId1: number;
  withSubId2: number;
  withSubId3: number;
  withSubId4: number;
  withSharedId: number;
  withReferringUrl: number;
  withLandingPageUrl: number;
  distinctSubId1Values: string[];       // first 10
  distinctCampaigns: Array<{ id: string; name: string | null }>;
}

export interface StatusAudit {
  // What status/state values Impact is actually returning.
  distinctActionStates: Array<{ value: string; count: number }>;
  distinctActionUpdateStates: Array<{ value: string; count: number }>;
  payoutValuePresence: { withPayout: number; withZeroPayout: number; withNullPayout: number };
  currenciesSeen: string[];
}

export interface ImpactAudit {
  ran_at: string;
  auth_configured: boolean;
  auth_result: 'ok' | 'missing_env' | 'rejected' | 'network_error' | 'unknown';
  account_sid_present: boolean;
  endpoints: {
    campaigns: EndpointAudit;
    actions: EndpointAudit;
    actionUpdates: EndpointAudit;
    clicks: EndpointAudit;
    invoices: EndpointAudit;
    reports: EndpointAudit;
  };
  attribution: AttributionAudit;
  statuses: StatusAudit;
  warnings: string[];
}

// Keys that MUST be redacted in the sample field inventory. Impact
// returns `Token` and account ids in some payloads; a Luke-friendly
// defensive redactor keeps secrets out of the UI even when API
// changes bring new fields.
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

function buildEndpointAudit(
  endpoint: string,
  description: string,
  resp: ImpactResponse<unknown>,
  pickRecords: (data: unknown) => unknown[],
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

function emptyEndpoint(endpoint: string, description: string): EndpointAudit {
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
  };
}

function pickActionsRecords(data: unknown): unknown[] {
  // Impact returns either {Actions: [...]}, {Records: [...]}, or an
  // array at the top level depending on endpoint. We try a few shapes
  // so a schema change doesn't black-hole the record discovery.
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

export async function runImpactAudit(): Promise<ImpactAudit> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];

  let client: ReturnType<typeof createImpactClient> | null = null;
  let authResult: ImpactAudit['auth_result'] = 'unknown';
  let authConfigured = false;
  let sidPresent = false;

  try {
    client = createImpactClient();
    authConfigured = true;
    sidPresent = Boolean(client.sid);
  } catch (err) {
    if (err instanceof ImpactAuthMissingError) {
      authResult = 'missing_env';
    } else {
      authResult = 'unknown';
    }
  }

  if (!client) {
    return {
      ran_at,
      auth_configured: authConfigured,
      auth_result: authResult,
      account_sid_present: sidPresent,
      endpoints: {
        campaigns: emptyEndpoint('/Campaigns', 'Brand/program relationships'),
        actions: emptyEndpoint('/Actions', 'Conversion/transaction list'),
        actionUpdates: emptyEndpoint('/ActionUpdates', 'Status and payout changes'),
        clicks: emptyEndpoint('/Clicks', 'Click-level data'),
        invoices: emptyEndpoint('/Invoices', 'Payout invoices'),
        reports: emptyEndpoint('/Reports', 'Pre-aggregated reports index'),
      },
      attribution: {
        totalSampleRows: 0,
        withSubId1: 0,
        withSubId2: 0,
        withSubId3: 0,
        withSubId4: 0,
        withSharedId: 0,
        withReferringUrl: 0,
        withLandingPageUrl: 0,
        distinctSubId1Values: [],
        distinctCampaigns: [],
      },
      statuses: {
        distinctActionStates: [],
        distinctActionUpdateStates: [],
        payoutValuePresence: { withPayout: 0, withZeroPayout: 0, withNullPayout: 0 },
        currenciesSeen: [],
      },
      warnings: ['IMPACT_ACCOUNT_SID or IMPACT_API_TOKEN is missing in this environment.'],
    };
  }

  // Use a conservative time window (90 days) so the first-run audit
  // doesn't request the entire history. ActionDateStart / End are
  // ISO-8601 instants per Impact's docs.
  const endIso = new Date().toISOString().slice(0, 19) + 'Z';
  const startDate = new Date(Date.now() - 90 * 86400000);
  const startIso = startDate.toISOString().slice(0, 19) + 'Z';

  const [campaigns, actions, actionUpdates, clicks, invoices, reports] = await Promise.all([
    client.get('/Campaigns'),
    client.get('/Actions', {
      PageSize: 10,
      Page: 1,
      ActionDateStart: startIso,
      ActionDateEnd: endIso,
    }),
    client.get('/ActionUpdates', {
      PageSize: 10,
      Page: 1,
      ActionUpdateStartDate: startIso,
      ActionUpdateEndDate: endIso,
    }),
    client.get('/Clicks', {
      PageSize: 10,
      Page: 1,
      StartDate: startIso,
      EndDate: endIso,
    }),
    client.get('/Invoices', { PageSize: 10, Page: 1 }),
    client.get('/Reports'),
  ]);

  // Classify the auth result based on the first call that produced a
  // definitive answer. 401/403 → rejected; network_error → infra.
  authResult = 'ok';
  for (const r of [campaigns, actions, actionUpdates, clicks, invoices, reports]) {
    if (r.status === 401 || r.status === 403) { authResult = 'rejected'; break; }
    if (r.status === 0) { authResult = 'network_error'; break; }
  }
  if (authResult === 'ok' && !(campaigns.ok || actions.ok)) authResult = 'unknown';

  if (actions.status === 404 || actionUpdates.status === 404) {
    warnings.push('Core /Actions or /ActionUpdates endpoint returned 404 — unusual. Confirm account tier and endpoint path.');
  }
  if (clicks.status === 404) {
    warnings.push('/Clicks returned 404. Impact may expose click data only via /ClickExport (async) for this account.');
  }

  const endpoints = {
    campaigns: buildEndpointAudit('/Campaigns', 'Brand/program relationships', campaigns, pickActionsRecords),
    actions: buildEndpointAudit('/Actions', 'Conversion/transaction list', actions, pickActionsRecords),
    actionUpdates: buildEndpointAudit('/ActionUpdates', 'Status and payout changes', actionUpdates, pickActionsRecords),
    clicks: buildEndpointAudit('/Clicks', 'Click-level data', clicks, pickActionsRecords),
    invoices: buildEndpointAudit('/Invoices', 'Payout invoices', invoices, pickActionsRecords),
    reports: buildEndpointAudit('/Reports', 'Pre-aggregated reports index', reports, pickActionsRecords),
  };

  // ─── Attribution + status + currency inventory ────────────────
  const actionRecords = pickActionsRecords(actions.data) as Array<Record<string, unknown>>;
  const clickRecords = pickActionsRecords(clicks.data) as Array<Record<string, unknown>>;
  const actionUpdateRecords = pickActionsRecords(actionUpdates.data) as Array<Record<string, unknown>>;
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

  // Campaign inventory from /Campaigns records.
  const campaignRecords = pickActionsRecords(campaigns.data) as Array<Record<string, unknown>>;
  attribution.distinctCampaigns = campaignRecords.slice(0, 25).map((c) => ({
    id: String(c['Id'] ?? c['CampaignId'] ?? ''),
    name: (c['Name'] ?? c['CampaignName'] ?? null) as string | null,
  }));

  // Status + currency inventory.
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

  return {
    ran_at,
    auth_configured: authConfigured,
    auth_result: authResult,
    account_sid_present: sidPresent,
    endpoints,
    attribution,
    statuses,
    warnings,
  };
}
