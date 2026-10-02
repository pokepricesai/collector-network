import 'server-only';

// Google Search Console client. Operates against the SA token
// minted by src/server/google/credentials.ts. All reads are scoped
// to webmasters.readonly.
//
// Row shape: GSC returns up to rowLimit (max 25000) rows per
// request. We paginate via startRow until a page returns fewer
// rows than the limit.
//
// Lag model: GSC data has 2–3 days of settling. Sync jobs always
// re-write a sliding window of recent days so late-arriving rows
// land on the correct date.

import { mintGoogleAccessToken } from './credentials';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export interface GscRow {
  date: string;
  page?: string;
  query?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscRawRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

async function gscToken(): Promise<string> {
  const r = await mintGoogleAccessToken([GSC_SCOPE]);
  return r.token;
}

async function queryOnce(
  token: string,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<GscRawRow[]> {
  const siteUrl = encodeURIComponent(propertyId);
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[gsc] ${propertyId} HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { rows?: GscRawRow[] };
  return json.rows ?? [];
}

/** Paginated query. `dimensions` must mirror the shape of keys[] you expect. */
export async function gscQueryAll(
  propertyId: string,
  startDate: string,
  endDate: string,
  dimensions: Array<'date' | 'page' | 'query'>,
  opts: { rowLimit?: number; maxPages?: number } = {},
): Promise<GscRow[]> {
  const token = await gscToken();
  const rowLimit = Math.min(opts.rowLimit ?? 25000, 25000);
  const maxPages = opts.maxPages ?? 20; // 500k row cap
  let startRow = 0;
  const out: GscRow[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await queryOnce(token, propertyId, {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      startRow,
      dataState: 'all',
    });
    for (const r of rows) {
      const keys = r.keys ?? [];
      const dateIdx = dimensions.indexOf('date');
      const pageIdx = dimensions.indexOf('page');
      const queryIdx = dimensions.indexOf('query');
      out.push({
        date: dateIdx >= 0 ? keys[dateIdx] ?? '' : '',
        page: pageIdx >= 0 ? keys[pageIdx] : undefined,
        query: queryIdx >= 0 ? keys[queryIdx] : undefined,
        clicks: Math.round(r.clicks ?? 0),
        impressions: Math.round(r.impressions ?? 0),
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      });
    }
    if (rows.length < rowLimit) return out;
    startRow += rowLimit;
  }
  return out;
}

export async function gscListSites(): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
  const token = await gscToken();
  const res = await fetch(
    'https://searchconsole.googleapis.com/webmasters/v3/sites',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`[gsc] list sites HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
  };
  return (body.siteEntry ?? []).map((e) => ({
    siteUrl: e.siteUrl ?? '',
    permissionLevel: e.permissionLevel ?? '',
  }));
}
