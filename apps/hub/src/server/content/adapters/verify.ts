import 'server-only';

// Confirms a freshly-published article URL actually serves 200 and
// contains an identifier (slug or title fragment). Separate from the
// adapter write so a successful write + unreachable public URL is
// surfaced as "publish failed, article still in DB" rather than
// silently marked success.
//
// Pragmatics: Vercel git auto-deploy (MTGPrices) takes ~30-90s; ISR
// on PokePrices means the first request after update triggers the
// regen. We poll for a short window so transient 404s during
// deploy/revalidation don't trip the check.

export interface VerifyUrlOptions {
  url: string;
  slug: string;
  titleFragment?: string;
  maxAttempts?: number;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface VerifyUrlResult {
  ok: boolean;
  status?: number;
  attempts: number;
  elapsedMs: number;
  error?: string;
}

export async function verifyLiveUrl(opts: VerifyUrlOptions): Promise<VerifyUrlResult> {
  const start = Date.now();
  const max = opts.maxAttempts ?? 6;
  const interval = opts.intervalMs ?? 10_000;
  const timeout = opts.timeoutMs ?? 15_000;
  let lastStatus = 0;
  let lastErr: string | undefined;

  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      const res = await fetch(opts.url, {
        signal: ac.signal,
        headers: { 'User-Agent': 'CollectorNetwork-PublishVerify/1.0' },
        cache: 'no-store',
      });
      clearTimeout(t);
      lastStatus = res.status;
      if (res.ok) {
        const body = await res.text().catch(() => '');
        // Lightweight presence check — the body should mention the
        // slug OR the title's first distinctive token. Prevents
        // "generic 200 page" false positives (soft 404s).
        const identifier = (opts.titleFragment ?? '').trim().slice(0, 40);
        const slugOk = opts.slug ? body.toLowerCase().includes(opts.slug.toLowerCase()) : true;
        const titleOk = identifier ? body.toLowerCase().includes(identifier.toLowerCase()) : true;
        if (slugOk && titleOk) {
          return { ok: true, status: res.status, attempts: attempt, elapsedMs: Date.now() - start };
        }
        // 200 but content missing — likely stale cache or deploy
        // mid-flight. Keep polling until we hit the attempt budget.
        lastErr = `200 but content missing (slug=${slugOk}, title=${titleOk})`;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    if (attempt < max) await sleep(interval);
  }
  return { ok: false, status: lastStatus, attempts: max, elapsedMs: Date.now() - start, error: lastErr ?? `last status ${lastStatus}` };
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
