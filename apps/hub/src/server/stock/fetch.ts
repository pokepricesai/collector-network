import 'server-only';

// CN-STOCK-02 · bounded HTTP fetch (TS port of scripts/_cn-stock-01/fetch.mjs).
// Identical semantics: timeout, size cap, host allowlist, private-IP
// guard, manual redirect allowlisting, explicit User-Agent.

const USER_AGENT = 'CollectorNetwork-StockProbe/0.1 (+contact: lukejosephpierce@gmail.com)';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export const PRIVATE_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^fe80:/i,
  /^::1$/,
  /^localhost$/i,
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,
];

export function isPrivateHost(host: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(host));
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  skipAllowlist?: boolean;
  hostAllowlist?: Set<string>;
  _hops?: number;
}

export type FetchResult =
  | { ok: true; status: number; body: string; bytes: number; duration_ms: number; truncated: boolean; final_url: string }
  | { ok: false; status: number; error: string; duration_ms: number; final_url?: string };

export async function fetchWithLimits(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const start = Date.now();
  let urlObj: URL;
  try { urlObj = new URL(url); } catch {
    return { ok: false, status: 0, error: 'invalid URL', duration_ms: 0 };
  }
  const host = urlObj.hostname.toLowerCase();
  if (isPrivateHost(host)) {
    return { ok: false, status: 0, error: `private/internal host blocked: ${host}`, duration_ms: 0 };
  }
  if (!options.skipAllowlist) {
    const allow = options.hostAllowlist;
    if (!allow || !(allow instanceof Set) || !allow.has(host)) {
      return { ok: false, status: 0, error: `host not on allowlist: ${host}`, duration_ms: 0 };
    }
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: ctl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
      },
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      clearTimeout(timer);
      const loc = res.headers.get('location');
      if (!loc) {
        return { ok: false, status: res.status, error: 'redirect without Location', duration_ms: Date.now() - start, final_url: url };
      }
      const nextUrl = new URL(loc, url).toString();
      const hops = (options._hops ?? 0) + 1;
      if (hops > 3) {
        return { ok: false, status: res.status, error: 'too many redirects', duration_ms: Date.now() - start, final_url: nextUrl };
      }
      return await fetchWithLimits(nextUrl, { ...options, _hops: hops });
    }

    const reader = res.body?.getReader?.();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let truncated = false;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            truncated = true;
            try { await reader.cancel(); } catch { /* ignore */ }
            break;
          }
          chunks.push(value);
        }
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer());
      bytes = buf.byteLength;
      chunks.push(buf);
      if (bytes > maxBytes) truncated = true;
    }
    clearTimeout(timer);

    const total = new Uint8Array(bytes);
    let offset = 0;
    for (const c of chunks) { total.set(c, offset); offset += c.byteLength; }
    const body = new TextDecoder('utf-8').decode(total);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}`,
        duration_ms: Date.now() - start,
        final_url: url,
      };
    }
    return {
      ok: true,
      status: res.status,
      body,
      bytes,
      duration_ms: Date.now() - start,
      truncated,
      final_url: url,
    };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = (err as Error)?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: isAbort ? `timeout after ${timeoutMs}ms` : `fetch error: ${(err as Error)?.message ?? String(err)}`,
      duration_ms: Date.now() - start,
    };
  }
}

/** Per-host politeness gate. */
export class HostGate {
  private readonly delayMs: number;
  private readonly lastAt: Map<string, number> = new Map();
  constructor(delayMs = 3000) { this.delayMs = delayMs; }
  async wait(host: string): Promise<void> {
    const now = Date.now();
    const prev = this.lastAt.get(host) ?? 0;
    const needed = this.delayMs - (now - prev);
    if (needed > 0) await new Promise((r) => setTimeout(r, needed));
    this.lastAt.set(host, Date.now());
  }
}
