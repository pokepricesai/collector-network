import 'server-only';

// Google Analytics 4 Data API client. Operates against the SA token
// minted by src/server/google/credentials.ts (scope
// analytics.readonly). Property IDs are the raw
// 'properties/<numeric>' form stored in network_google_properties.
//
// We default the "Users" metric to activeUsers for consistency with
// the dashboard's single definition.

import { mintGoogleAccessToken } from './credentials';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export interface Ga4DailyRow {
  date: string;              // YYYY-MM-DD
  activeUsers: number;
  newUsers: number;
  sessions: number;
  engagedSessions: number;
  averageSessionDuration: number;
  screenPageViews: number;
}

interface Ga4RunReportBody {
  dateRanges: Array<{ startDate: string; endDate: string }>;
  dimensions: Array<{ name: string }>;
  metrics: Array<{ name: string }>;
  limit?: string;
  offset?: string;
  returnPropertyQuota?: boolean;
}

interface Ga4RawRow {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

async function ga4Token(): Promise<string> {
  const r = await mintGoogleAccessToken([GA4_SCOPE]);
  return r.token;
}

function toDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export async function ga4RunReport(
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Ga4DailyRow[]> {
  const token = await ga4Token();
  // propertyId already starts with "properties/" so trim before concat.
  const propPath = propertyId.replace(/^properties\//, '');
  const body: Ga4RunReportBody = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'sessions' },
      { name: 'engagedSessions' },
      { name: 'averageSessionDuration' },
      { name: 'screenPageViews' },
    ],
    limit: '100000',
  };
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propPath}:runReport`,
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
    throw new Error(`[ga4] ${propertyId} HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { rows?: Ga4RawRow[] };
  const rows = json.rows ?? [];
  return rows.map((r) => {
    const date = toDate(r.dimensionValues?.[0]?.value ?? '');
    const m = r.metricValues ?? [];
    return {
      date,
      activeUsers: Math.round(parseFloat(m[0]?.value ?? '0')),
      newUsers: Math.round(parseFloat(m[1]?.value ?? '0')),
      sessions: Math.round(parseFloat(m[2]?.value ?? '0')),
      engagedSessions: Math.round(parseFloat(m[3]?.value ?? '0')),
      averageSessionDuration: parseFloat(m[4]?.value ?? '0'),
      screenPageViews: Math.round(parseFloat(m[5]?.value ?? '0')),
    };
  });
}
