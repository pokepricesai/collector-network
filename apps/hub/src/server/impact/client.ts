import 'server-only';

// Minimal Impact Media Partner API client.
//
// Auth: HTTP Basic, where username = Account SID and password = API
// token (per Impact's "Interface Authentication" docs). Both come
// from Vercel env; they are never emitted to the client bundle, never
// logged, never surfaced to a browser context.
//
// Base URL: https://api.impact.com
// Mediapartner endpoints are rooted at /Mediapartners/{AccountSid}
//
// We default to Accept: application/json. Impact also supports XML
// but JSON is the simpler read.
//
// Rate limits: ~1,000 req/hour per account on most endpoints. The
// audit route is designed to burn ~6 calls per run.

const BASE_URL = 'https://api.impact.com';

export class ImpactAuthMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImpactAuthMissingError';
  }
}

/** The error we surface up to the caller. Never carries the token. */
export class ImpactApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly endpoint: string,
    public readonly responseExcerpt: string,
  ) {
    super(message);
    this.name = 'ImpactApiError';
  }
}

export interface ImpactResponse<T = unknown> {
  endpoint: string;
  status: number;
  ok: boolean;
  data: T | null;
  rawExcerpt: string;      // first 2 KB of body for diagnostics
  errorMessage: string | null;
  contentType: string | null;
  bodyBytes: number;
}

/**
 * Creates a per-request client. We intentionally recreate the Basic
 * header per client instance so the credentials are never held in a
 * module-scoped singleton — makes it harder for a leak to persist
 * across requests.
 */
export function createImpactClient() {
  const sid = (process.env['IMPACT_ACCOUNT_SID'] ?? '').trim();
  const token = (process.env['IMPACT_API_TOKEN'] ?? '').trim();
  if (!sid || !token) {
    throw new ImpactAuthMissingError(
      'IMPACT_ACCOUNT_SID or IMPACT_API_TOKEN is not configured in the server environment.',
    );
  }
  const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;

  async function get<T = unknown>(
    path: string,
    search?: Record<string, string | number>,
  ): Promise<ImpactResponse<T>> {
    const url = new URL(`${BASE_URL}/Mediapartners/${encodeURIComponent(sid)}${path}`);
    if (search) {
      for (const [k, v] of Object.entries(search)) {
        url.searchParams.set(k, String(v));
      }
    }
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          'User-Agent': 'collector-network-os/1.0 (+https://collector-network.vercel.app)',
        },
        cache: 'no-store',
      });
    } catch (err) {
      return {
        endpoint: path,
        status: 0,
        ok: false,
        data: null,
        rawExcerpt: '',
        errorMessage: err instanceof Error ? err.message : String(err),
        contentType: null,
        bodyBytes: 0,
      };
    }
    const rawFull = await response.text();
    const rawExcerpt = rawFull.length > 2048 ? rawFull.slice(0, 2048) + '…' : rawFull;
    const contentType = response.headers.get('content-type');
    let data: T | null = null;
    if (response.ok && contentType && contentType.includes('application/json')) {
      try {
        data = JSON.parse(rawFull) as T;
      } catch {
        data = null;
      }
    }
    const errorMessage = response.ok
      ? null
      : `${response.status} ${response.statusText}`.trim();
    return {
      endpoint: path,
      status: response.status,
      ok: response.ok,
      data,
      rawExcerpt,
      errorMessage,
      contentType,
      bodyBytes: rawFull.length,
    };
  }

  return { get, sid };
}

export type ImpactClient = ReturnType<typeof createImpactClient>;
