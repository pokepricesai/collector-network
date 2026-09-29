// Narrow in-process rate limiter. Sized for the Ask YGOPrices endpoint:
// stops abusive bursts, unnoticed by normal users, no external deps or
// secrets. Distributed guarantee is best-effort — Fluid Compute reuses
// function instances across concurrent requests, so this catches the
// common case (one bad actor from one IP) while remaining zero-cost
// operationally.
//
// Contract:
//   check(key) → { allowed, retryAfterMs }
// A hit that returns allowed=false is a client's responsibility to
// surface with HTTP 429 and a Retry-After header.

interface WindowEntry {
  timestamps: number[]; // ms epoch; sorted ascending
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterMs: number;
}

const buckets = new Map<string, WindowEntry>();

// Periodically prune empty buckets so a long-running instance does
// not grow unbounded. Cheap: only runs when the map has > 500 keys.
function maybePrune(now: number, windowMs: number): void {
  if (buckets.size <= 500) return;
  const cutoff = now - windowMs;
  for (const [k, entry] of buckets) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) buckets.delete(k);
  }
}

export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitVerdict {
  const now = Date.now();
  const cutoff = now - opts.windowMs;
  const entry = buckets.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  if (entry.timestamps.length >= opts.max) {
    // Oldest hit inside the window dictates when the next slot frees up.
    const oldest = entry.timestamps[0]!;
    buckets.set(key, entry);
    return { allowed: false, retryAfterMs: Math.max(0, oldest + opts.windowMs - now) };
  }
  entry.timestamps.push(now);
  buckets.set(key, entry);
  maybePrune(now, opts.windowMs);
  return { allowed: true, retryAfterMs: 0 };
}

// Pull the client IP out of the incoming request. Vercel sets
// `x-forwarded-for` and `x-real-ip`; we take the leftmost XFF entry
// which is the origin client (Vercel appends downstream hops on the
// right).
export function clientIpFrom(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
