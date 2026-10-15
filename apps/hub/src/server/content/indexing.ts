import 'server-only';

// Google + Bing indexing checklist helpers. Google stays a manual
// operator action per Slice C spec (we do NOT use the restricted
// Google Indexing API for standard articles) — the UI records
// {google_index_requested_at, google_index_requested_by} as a
// receipt of the human submission.
//
// Bing: automatic via the site's own IndexNow key, posted at
// https://api.indexnow.org/indexnow. We record the raw response
// so the UI can show "submission accepted" distinct from "indexed".

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SiteIndexNowCfg {
  canonical_url: string;
  indexnow_key: string | null;
  indexnow_enabled: boolean;
}

export async function loadSiteIndexNow(sb: SupabaseClient, siteId: string): Promise<SiteIndexNowCfg | null> {
  const { data } = await sb.from('network_sites')
    .select('canonical_url, indexnow_key, indexnow_enabled')
    .eq('id', siteId).maybeSingle();
  if (!data) return null;
  const row = data as { canonical_url: string | null; indexnow_key: string | null; indexnow_enabled: boolean | null };
  if (!row.canonical_url) return null;
  return {
    canonical_url: row.canonical_url,
    indexnow_key: row.indexnow_key,
    indexnow_enabled: Boolean(row.indexnow_enabled),
  };
}

export interface IndexNowSubmitResult {
  ok: boolean;
  status: number;
  skipped?: 'disabled' | 'no_key' | 'no_url';
  error?: string;
  submittedAtIso: string;
}

/**
 * Fire-and-record IndexNow submission for a single URL. Never throws
 * — a failed submission is a soft problem, not a reason to roll back
 * a successful publish.
 */
export async function submitArticleToIndexNow(opts: {
  url: string | null;
  site: SiteIndexNowCfg;
}): Promise<IndexNowSubmitResult> {
  const submittedAtIso = new Date().toISOString();
  if (!opts.url) return { ok: false, status: 0, skipped: 'no_url', submittedAtIso };
  if (!opts.site.indexnow_enabled) return { ok: false, status: 0, skipped: 'disabled', submittedAtIso };
  if (!opts.site.indexnow_key) return { ok: false, status: 0, skipped: 'no_key', submittedAtIso };

  const origin = opts.site.canonical_url.replace(/\/$/, '');
  const key = opts.site.indexnow_key;
  const payload = {
    host: new URL(origin).host,
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList: [opts.url],
  };

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ok = res.ok || res.status === 202;
    return { ok, status: res.status, submittedAtIso, ...(ok ? {} : { error: `IndexNow HTTP ${res.status}` }) };
  } catch (e) {
    return { ok: false, status: 0, submittedAtIso, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Called from the publish success path. Submits the live URL to the
 * target site's IndexNow endpoint and records the response on the
 * article row. Does not throw.
 */
export async function autoSubmitBingIndexNow(
  sb: SupabaseClient,
  args: { articleId: string; siteId: string; url: string | null },
): Promise<IndexNowSubmitResult> {
  const site = await loadSiteIndexNow(sb, args.siteId);
  if (!site) return { ok: false, status: 0, skipped: 'disabled', submittedAtIso: new Date().toISOString() };
  const r = await submitArticleToIndexNow({ url: args.url, site });
  // Record on article only if the submission was actually attempted
  // (not when skipped). Keep the raw response so the checklist row
  // can show "accepted" / error reason without re-querying.
  if (!r.skipped) {
    await sb.from('network_articles').update({
      bing_index_submitted_at: r.submittedAtIso,
      bing_index_submission_response: { ok: r.ok, status: r.status, error: r.error ?? null } as unknown as Record<string, unknown>,
    }).eq('id', args.articleId);
  }
  return r;
}
