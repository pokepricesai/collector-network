// Narrow in-process rate limiter. Sized for the Ask OnePiecePrices
// endpoint: stops abusive bursts, unnoticed by normal users, no
// external deps or secrets. Distributed guarantee is best-effort;
// Fluid Compute reuses function instances across concurrent requests,
// so this catches the common case (one bad actor from one IP) while
// remaining zero-cost operationally.

interface WindowEntry {
  timestamps: number[];
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
    const oldest = entry.timestamps[0]!;
    buckets.set(key, entry);
    return { allowed: false, retryAfterMs: Math.max(0, oldest + opts.windowMs - now) };
  }
  entry.timestamps.push(now);
  buckets.set(key, entry);
  maybePrune(now, opts.windowMs);
  return { allowed: true, retryAfterMs: 0 };
}

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
