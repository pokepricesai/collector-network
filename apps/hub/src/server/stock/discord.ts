import 'server-only';

// CN-STOCK-02 · Discord webhook delivery.
//
// Sends one message per cn_stock_outbox row to a private webhook.
// The webhook URL is read from env on EVERY call (no caching) so
// a rotation doesn't require a redeploy — the next cron fire
// picks up the new value.
//
// The webhook URL is NEVER returned from this module, NEVER
// logged, NEVER included in any error message or stored payload.
// Only the opaque `target` label (e.g. 'discord:test') appears
// in the outbox row.

import type { EventRow, WatchlistRow } from './types';

export type SendResult =
  | { kind: 'delivered'; status_code: number }
  | { kind: 'retryable'; status_code: number; retry_after_ms: number | null; summary: string }
  | { kind: 'permanent'; status_code: number; summary: string }
  | { kind: 'timeout_ambiguous'; summary: string }
  | { kind: 'config_missing'; summary: string };

/** Compose the Discord message body. Pure. Shape chosen to match
 *  the brief's format, including an explicit UTC detected timestamp
 *  and the direct product URL (not a retailer homepage). */
export function buildPayload(
  event: Pick<EventRow, 'detected_at' | 'price' | 'currency' | 'evidence_summary'>,
  listing: Pick<WatchlistRow, 'retailer' | 'country' | 'game' | 'product_name' | 'variant' | 'url'>,
): { content: string } {
  const gameLabel = ({
    pokemon: 'Pokémon',
    mtg: 'Magic: The Gathering',
    ygo: 'Yu-Gi-Oh!',
    onepiece: 'One Piece',
    lorcana: 'Disney Lorcana',
    other: 'Other',
  } as const)[listing.game];
  const price = event.price != null && event.currency
    ? `${event.currency} ${event.price.toFixed(2)}`
    : 'Not displayed';
  const variant = listing.variant ? ` (${listing.variant})` : '';
  const detected = new Date(event.detected_at).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  const lines = [
    '**RESTOCK DETECTED**',
    '',
    `Game: ${gameLabel}`,
    `Product: ${listing.product_name}${variant}`,
    `Retailer: ${listing.retailer.replace(/_/g, ' ')} · ${listing.country}`,
    `Price: ${price}`,
    'Stock: Back in stock',
    `Detected: ${detected}`,
    `Product link: ${listing.url}`,
  ];
  return { content: lines.join('\n') };
}

/** Read the webhook URL from env. Returns null when unset — the
 *  caller marks the outbox row `config_missing` and does NOT
 *  retry, so a missing env var doesn't burn retries. */
function getWebhook(target: string): string | null {
  // Future-proof multiple targets by letting `target` select a
  // specific env var ('discord:test' → STOCK_PROBE_DISCORD_WEBHOOK,
  // 'discord:ops' → STOCK_PROBE_DISCORD_WEBHOOK_OPS, etc.). For
  // the first pilot we only read the default.
  if (target === 'discord:test' || target === 'discord') {
    return process.env['STOCK_PROBE_DISCORD_WEBHOOK'] ?? null;
  }
  if (target.startsWith('discord:')) {
    const suffix = target.slice('discord:'.length).toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return process.env[`STOCK_PROBE_DISCORD_WEBHOOK_${suffix}`] ?? null;
  }
  return null;
}

/** POST to Discord with a bounded timeout. Classifies the
 *  outcome for the outbox worker:
 *
 *    delivered           2xx response
 *    retryable           429 (with Retry-After) or 5xx
 *    permanent           400-class except 429
 *    timeout_ambiguous   client-side abort — the message MIGHT
 *                        have been delivered Discord-side; we
 *                        don't retry (would duplicate alerts)
 *    config_missing      env var not set; worker should skip
 *                        this row until operator configures it
 *
 *  The URL is read once per call, never logged. All error strings
 *  returned here have been scrubbed. */
export async function sendDiscord(
  target: string,
  payload: { content: string },
  options: { timeoutMs?: number } = {},
): Promise<SendResult> {
  const webhook = getWebhook(target);
  if (!webhook) {
    return { kind: 'config_missing', summary: `env var for ${target} not set` };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), options.timeoutMs ?? 10_000);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    clearTimeout(timer);
    if (res.ok) return { kind: 'delivered', status_code: res.status };
    // 429 — honour Retry-After (seconds or RFC date).
    if (res.status === 429) {
      const ra = res.headers.get('retry-after');
      const retry_after_ms = parseRetryAfter(ra);
      return { kind: 'retryable', status_code: 429, retry_after_ms, summary: `429 rate_limited; retry_after=${ra ?? 'none'}` };
    }
    if (res.status >= 500 && res.status <= 599) {
      return { kind: 'retryable', status_code: res.status, retry_after_ms: null, summary: `${res.status} server_error` };
    }
    // 4xx (not 429) — don't retry. Discord's 400-class errors
    // usually mean the webhook is wrong or revoked.
    return { kind: 'permanent', status_code: res.status, summary: `${res.status} client_error` };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = (err as Error)?.name === 'AbortError';
    if (isAbort) {
      // Brief rule: a timed-out webhook POST might have been
      // delivered Discord-side. We don't retry. Operator judges
      // from the outbox row + Discord channel.
      return { kind: 'timeout_ambiguous', summary: 'client-side timeout; message may or may not have been delivered' };
    }
    // Other network errors (ENOTFOUND, ECONNRESET, etc.) → retryable.
    return { kind: 'retryable', status_code: 0, retry_after_ms: null, summary: `network_error: ${(err as Error)?.message ?? 'unknown'}` };
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  // RFC date form.
  const t = Date.parse(value);
  if (Number.isFinite(t)) {
    const delta = t - Date.now();
    return delta > 0 ? delta : null;
  }
  return null;
}

/** Exponential backoff schedule used by deliver.ts. */
export function nextRetryDelayMs(attempt_count: number, retry_after_ms: number | null): number {
  if (retry_after_ms != null) return retry_after_ms;
  // 1m, 2m, 5m, 15m, 60m
  const seq = [60_000, 120_000, 300_000, 900_000, 3_600_000];
  return seq[Math.min(attempt_count, seq.length - 1)]!;
}
