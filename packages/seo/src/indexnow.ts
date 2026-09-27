// packages/seo/src/indexnow.ts
// Fail-safe IndexNow submission helper. Canonical-only, batched at
// 10K URLs per POST, retries transient failures only. Suitable for
// editorial updates or catalogue add/remove events; NOT for daily
// price ingest (would swamp the endpoint).
//
// Read INDEXNOW_ENABLED + INDEXNOW_KEY from env. When either is
// missing/disabled the caller gets a no-op result and never throws.

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS_PER_BATCH = 10_000;
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface IndexNowConfig {
  enabled: boolean;
  key: string | null;
  keyLocation: string | null;
}

export interface IndexNowBatchResult {
  index: number;
  size: number;
  attempts: number;
  status: number;
  ok: boolean;
  error?: string;
}

export interface IndexNowResult {
  totalInput: number;
  totalSubmitted: number;
  totalRejected: number;
  batches: IndexNowBatchResult[];
  disabled?: boolean;
}

export function readIndexNowConfig(siteOrigin: string): IndexNowConfig {
  const enabled = process.env['INDEXNOW_ENABLED'] === 'true';
  const key = (process.env['INDEXNOW_KEY'] ?? '').trim() || null;
  const keyLocation = key ? `${siteOrigin}/${key}.txt` : null;
  return { enabled, key, keyLocation };
}

/** Drop empty, off-domain, and duplicate URLs. Strip hash + query. */
export function canonicaliseUrls(
  siteOrigin: string,
  urls: readonly string[],
): { urls: string[]; rejected: number } {
  const seen = new Set<string>();
  const out: string[] = [];
  let rejected = 0;
  for (const raw of urls) {
    const s = (raw ?? '').trim();
    if (!s) { rejected++; continue; }
    if (!s.startsWith(`${siteOrigin}/`) && s !== siteOrigin) { rejected++; continue; }
    const cleaned = s.split('#')[0]!.split('?')[0]!;
    const withoutTrailing = cleaned === siteOrigin ? cleaned : cleaned.replace(/\/+$/, '');
    if (seen.has(withoutTrailing)) { rejected++; continue; }
    seen.add(withoutTrailing);
    out.push(withoutTrailing);
  }
  return { urls: out, rejected };
}

export async function submitIndexNow(
  siteOrigin: string,
  urls: readonly string[],
  { fetchImpl = fetch, maxAttempts = 3 }: { fetchImpl?: typeof fetch; maxAttempts?: number } = {},
): Promise<IndexNowResult> {
  const config = readIndexNowConfig(siteOrigin);
  const { urls: cleanUrls, rejected } = canonicaliseUrls(siteOrigin, urls);

  if (!config.enabled || !config.key || !config.keyLocation) {
    return {
      totalInput: urls.length,
      totalSubmitted: 0,
      totalRejected: rejected + cleanUrls.length,
      batches: [],
      disabled: true,
    };
  }

  const batches: IndexNowBatchResult[] = [];
  let submitted = 0;
  for (let i = 0; i < cleanUrls.length; i += MAX_URLS_PER_BATCH) {
    const slice = cleanUrls.slice(i, i + MAX_URLS_PER_BATCH);
    const batch = await postBatch(slice, config, i, fetchImpl, maxAttempts);
    batches.push(batch);
    if (batch.ok) submitted += batch.size;
  }

  return {
    totalInput: urls.length,
    totalSubmitted: submitted,
    totalRejected: rejected + (cleanUrls.length - submitted),
    batches,
  };
}

async function postBatch(
  urls: string[],
  config: IndexNowConfig,
  index: number,
  fetchImpl: typeof fetch,
  maxAttempts: number,
): Promise<IndexNowBatchResult> {
  let lastStatus = 0;
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: new URL(config.keyLocation!).host,
          key: config.key,
          keyLocation: config.keyLocation,
          urlList: urls,
        }),
      });
      lastStatus = res.status;
      if (res.ok || res.status === 202) {
        return { index, size: urls.length, attempts: attempt, status: res.status, ok: true };
      }
      if (!RETRY_STATUS.has(res.status)) {
        return { index, size: urls.length, attempts: attempt, status: res.status, ok: false, error: `permanent status ${res.status}` };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < maxAttempts) await sleep(200 * attempt);
  }
  return { index, size: urls.length, attempts: maxAttempts, status: lastStatus, ok: false, error: lastError ?? `retried ${maxAttempts} times` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
