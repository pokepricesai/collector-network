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
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[yugioh/safe] ${label} failed: ${message}`);
    return { ok: false, value: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export function unwrapOr<T, F>(result: SafeResult<T>, fallback: F): T | F {
  return result.ok ? result.value : fallback;
}
