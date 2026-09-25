// IndexNow submission helper. Mirrors the fail-safe design used by
// the MTGPrices site — canonical-only, batched at 10K URLs per POST,
// retries transient failures only. Deliberately not wired into daily
// price ingest to avoid swamping the endpoint; suitable for editorial
// updates and catalogue add/remove events.

import { SITE_URL } from './site-url';

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

export function readIndexNowConfig(): IndexNowConfig {
  const enabled = process.env['INDEXNOW_ENABLED'] === 'true';
  const key = (process.env['INDEXNOW_KEY'] ?? '').trim() || null;
  const keyLocation = key ? `${SITE_URL}/${key}.txt` : null;
  return { enabled, key, keyLocation };
}

/** Normalise a caller's URL list. Drops empty, off-domain, and
 *  duplicate entries; strips hash + query. Returned list is safe to
 *  hand to IndexNow. */
export function canonicaliseUrls(
  urls: readonly string[],
): { urls: string[]; rejected: number } {
  const seen = new Set<string>();
  const out: string[] = [];
  let rejected = 0;
  for (const raw of urls) {
    const s = (raw ?? '').trim();
    if (!s) {
      rejected += 1;
      continue;
    }
    if (!s.startsWith(`${SITE_URL}/`) && s !== SITE_URL) {
      rejected += 1;
      continue;
    }
    // Strip hash + query and any trailing slash except the site root.
    const cleaned = s.split('#')[0]!.split('?')[0]!;
    const withoutTrailing =
      cleaned === SITE_URL ? cleaned : cleaned.replace(/\/+$/, '');
    if (seen.has(withoutTrailing)) {
      rejected += 1;
      continue;
    }
    seen.add(withoutTrailing);
    out.push(withoutTrailing);
  }
  return { urls: out, rejected };
}

/** Submit URLs. When disabled, returns a no-op result and never
 *  throws. */
export async function submitIndexNow(
  urls: readonly string[],
  {
    fetchImpl = fetch,
    maxAttempts = 3,
  }: { fetchImpl?: typeof fetch; maxAttempts?: number } = {},
): Promise<IndexNowResult> {
  const config = readIndexNowConfig();
  const { urls: cleanUrls, rejected } = canonicaliseUrls(urls);

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
    const batchResult = await postBatch(
      slice,
      config,
      i,
      fetchImpl,
      maxAttempts,
    );
    batches.push(batchResult);
    if (batchResult.ok) submitted += batchResult.size;
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
        return {
          index,
          size: urls.length,
          attempts: attempt,
          status: res.status,
          ok: true,
        };
      }
      if (!RETRY_STATUS.has(res.status)) {
        return {
          index,
          size: urls.length,
          attempts: attempt,
          status: res.status,
          ok: false,
          error: `permanent status ${res.status}`,
        };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    // Exponential backoff between transient retries.
    if (attempt < maxAttempts) {
      await sleep(200 * attempt);
    }
  }
  return {
    index,
    size: urls.length,
    attempts: maxAttempts,
    status: lastStatus,
    ok: false,
    error: lastError ?? `retried ${maxAttempts} times`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
