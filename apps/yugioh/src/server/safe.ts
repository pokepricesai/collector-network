// Fail-soft wrapper for pricing / secondary queries. Slice 6 shipped
// a cold-500 on the LOB-001 printing page when the streaming SSR ran
// while a Supabase call was mid-timeout. Every subsequent request
// returned 200, but a first-hit 500 is a bad experience.
//
// Pattern: wrap each independent read in `safe()`. The caller renders
// a degraded state (e.g. "Pricing temporarily unavailable — refresh
// in a moment") instead of throwing at the page boundary.

export interface SafeSuccess<T> {
  ok: true;
  value: T;
  error: null;
}

export interface SafeFailure {
  ok: false;
  value: null;
  error: string;
}

export type SafeResult<T> = SafeSuccess<T> | SafeFailure;

const DEFAULT_TIMEOUT_MS = 6_000;

export async function safe<T>(
  label: string,
  fn: () => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<SafeResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    // Wrap in a race so an unresponsive query can't hang the render.
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`timeout after ${timeoutMs}ms`)),
        );
      }),
    ]);
    return { ok: true, value, error: null };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    // Structured single-line log: easy to grep in Vercel logs and
    // deliberately free of credentials — the label describes the
    // operation and the message is whatever the underlying client
    // returned (Supabase error messages are safe: no keys/URLs).
    const category = classifyError(message);
    console.warn(
      `[yugioh/safe] label=${label} status=fail category=${category} duration_ms=${durationMs} timeout_ms=${timeoutMs} msg=${JSON.stringify(message.slice(0, 240))}`,
    );
    return { ok: false, value: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function classifyError(message: string): 'timeout' | 'fetch' | 'db' | 'other' {
  if (/timeout after \d+ms|canceling statement due to statement timeout/i.test(message)) return 'timeout';
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) return 'fetch';
  if (/PGRST|Bad Request|HTTP 5\d\d/i.test(message)) return 'db';
  return 'other';
}

export function unwrapOr<T, F>(result: SafeResult<T>, fallback: F): T | F {
  return result.ok ? result.value : fallback;
}

//  retryOnce — bounded retry for structural DB reads whose failure
//  would take down the whole page. Only retries errors that look
//  transient (timeout, connection reset, PGRST 5xx, statement
//  timeout). Non-transient errors are rethrown immediately so a
//  genuine bug does not get papered over. Retries exactly once so
//  a persistent outage still surfaces at the page boundary.
//
//  Structured single-line log on retry so operators can measure how
//  often this saves a page render in production.
export async function retryOnce<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isTransientDbError(message)) {
      throw err;
    }
    const firstMs = Math.round(performance.now() - start);
    console.warn(
      `[yugioh/retry] label=${label} attempt=1 status=fail category=${classifyError(message)} duration_ms=${firstMs} msg=${JSON.stringify(message.slice(0, 200))}`,
    );
    const secondStart = performance.now();
    try {
      const value = await fn();
      const secondMs = Math.round(performance.now() - secondStart);
      console.warn(
        `[yugioh/retry] label=${label} attempt=2 status=ok recovered_from=${classifyError(message)} duration_ms=${secondMs}`,
      );
      return value;
    } catch (retryErr) {
      const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
      const secondMs = Math.round(performance.now() - secondStart);
      console.error(
        `[yugioh/retry] label=${label} attempt=2 status=fail category=${classifyError(retryMessage)} duration_ms=${secondMs} msg=${JSON.stringify(retryMessage.slice(0, 200))}`,
      );
      throw retryErr;
    }
  }
}

function isTransientDbError(message: string): boolean {
  if (/timeout after \d+ms/i.test(message)) return true;
  if (/canceling statement due to statement timeout/i.test(message)) return true;
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) return true;
  if (/fetch failed/i.test(message)) return true;
  // PostgREST wraps DB errors with a code — 5xx-shaped statuses are
  // retryable; auth / schema errors (4xx-shaped, "PGRST100" etc.) are
  // not because retrying will just fail again the same way.
  if (/HTTP 5\d\d|PGRST5\d\d|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout/i.test(message)) return true;
  return false;
}
