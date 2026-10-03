import 'server-only';

// BigQuery REST client. Uses the shared WIF-backed access token
// (mintGoogleAccessToken) scoped to bigquery.readonly. The service
// account `cn-os-analytics@collector-network-os.iam.gserviceaccount.com`
// holds `bigquery.jobUser + bigquery.dataViewer` on the external
// `pokeprices-seo` project — so we execute jobs in our own project
// context but read tables in pokeprices-seo.
//
// Scope choices are deliberately read-only; this layer MUST NOT
// have DML capability. Any write-like call (jobs.insert with LOAD
// / COPY / write-disposition) would require bigquery.dataEditor
// which is not granted.
//
// Cost-visibility: every query response includes totalBytesBilled
// which we persist in network_job_runs.metadata so operators can
// see how much they're scanning.

import { mintGoogleAccessToken } from './credentials';

const BQ_SCOPES = [
  'https://www.googleapis.com/auth/bigquery.readonly',
];

// We run jobs in the Collector Network project; we read tables
// in the external PokePrices project. jobProjectId is CN; the
// SQL references the external dataset by fully-qualified name.
const JOB_PROJECT_ID = process.env['GCP_PROJECT_ID'] ?? 'collector-network-os';

export interface BqQueryResult<T = Record<string, unknown>> {
  rows: T[];
  totalBytesProcessed: number;
  totalBytesBilled: number;
  totalSlotMs: number;
  jobId: string | null;
  cacheHit: boolean;
}

interface BqRawField { name: string; type: string; mode?: string }
interface BqRawRow { f?: Array<{ v?: unknown }> }
interface BqRawResponse {
  schema?: { fields?: BqRawField[] };
  rows?: BqRawRow[];
  totalRows?: string;
  totalBytesProcessed?: string;
  totalBytesBilled?: string;
  totalSlotMs?: string;
  jobReference?: { jobId?: string };
  jobComplete?: boolean;
  cacheHit?: boolean;
  errors?: Array<{ message?: string; reason?: string }>;
}

function coerce(value: unknown, type: string): unknown {
  if (value == null) return null;
  const s = String(value);
  switch (type) {
    case 'INTEGER':
    case 'INT64':
      return Number(s);
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC':
      return Number(s);
    case 'BOOLEAN':
    case 'BOOL':
      return s === 'true';
    case 'DATE':
    case 'STRING':
      return s;
    case 'TIMESTAMP':
      // BigQuery returns timestamps as numeric seconds-since-epoch
      // in a REST query response.
      return new Date(Number(s) * 1000).toISOString();
    default:
      return s;
  }
}

/**
 * Run a one-shot BigQuery SQL query via jobs.query. Enforces a
 * maximumBytesBilled cap so a malformed query cannot runaway-scan.
 *
 * `project` is the project whose quota pays for the job; the SQL
 * can reference other projects (eg. pokeprices-seo) if the SA has
 * dataViewer on them.
 */
export async function bqQuery<T = Record<string, unknown>>(
  sql: string,
  opts: {
    maximumBytesBilledMb?: number;
    timeoutMs?: number;
    project?: string;
    useLegacySql?: boolean;
  } = {},
): Promise<BqQueryResult<T>> {
  const tok = await mintGoogleAccessToken(BQ_SCOPES);
  const project = opts.project ?? JOB_PROJECT_ID;
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`;
  const body = {
    query: sql,
    useLegacySql: opts.useLegacySql ?? false,
    maximumBytesBilled: String((opts.maximumBytesBilledMb ?? 2048) * 1024 * 1024),
    timeoutMs: String(Math.min(opts.timeoutMs ?? 60000, 180000)),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tok.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[bq] HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const j = (await res.json()) as BqRawResponse;
  if (j.errors && j.errors.length > 0) {
    throw new Error(`[bq] ${j.errors.map((e) => e.message).filter(Boolean).join('; ')}`);
  }
  if (!j.jobComplete) {
    // Query timed out server-side; caller should raise timeoutMs or
    // simplify the query. We treat this as an error so operators
    // notice.
    throw new Error(`[bq] query did not complete within server timeout`);
  }
  const fields = j.schema?.fields ?? [];
  const rawRows = j.rows ?? [];
  const rows: T[] = rawRows.map((r) => {
    const out: Record<string, unknown> = {};
    const cells = r.f ?? [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      out[f.name] = coerce(cells[i]?.v, f.type);
    }
    return out as T;
  });
  return {
    rows,
    totalBytesProcessed: Number(j.totalBytesProcessed ?? '0'),
    totalBytesBilled: Number(j.totalBytesBilled ?? '0'),
    totalSlotMs: Number(j.totalSlotMs ?? '0'),
    jobId: j.jobReference?.jobId ?? null,
    cacheHit: j.cacheHit ?? false,
  };
}

/** List datasets in a project — used by the integration-health check. */
export async function bqListDatasets(project: string): Promise<Array<{ id: string }>> {
  const tok = await mintGoogleAccessToken(BQ_SCOPES);
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets?maxResults=50`,
    { headers: { Authorization: `Bearer ${tok.token}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[bq] list datasets ${project}: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const j = (await res.json()) as { datasets?: Array<{ datasetReference?: { datasetId?: string } }> };
  return (j.datasets ?? []).map((d) => ({ id: d.datasetReference?.datasetId ?? '' }));
}

/** Format a bytes count for admin display. */
export function formatBqBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/** Rough on-demand pricing: $6.25 per TiB processed (us), convert
 *  bytes-billed → USD. Used only for approximate cost display. */
export function estimateBqCostUsd(bytesBilled: number): number {
  const tib = bytesBilled / (1024 ** 4);
  return tib * 6.25;
}
