// Shared affiliate-click ingest for Collector Network specialist
// sites. One tiny Next.js route handler, re-used by every site.
//
// Design:
//   * Fail-open on the client — the browser calls us with
//     navigator.sendBeacon and ignores the response. We validate,
//     insert, and return 200/400/503 without expecting the client
//     to read it.
//
//   * Privacy mirrored from PokePrices' existing affiliate_events:
//     NO IP, NO User-Agent, NO Referer, NO email, NO user_id.
//     session_id is optional and only persisted when the client
//     supplies one.
//
//   * Writes go to public.network_affiliate_clicks on the shared
//     Collector Network Supabase project via the service-role
//     client supplied by the caller. The service role is kept
//     server-side; this module never reads from or returns the
//     service key.
//
//   * Validation is strict: placement is bounded + regex-checked,
//     all string fields capped, site_id MUST be supplied by the
//     caller (never from the client) so a public endpoint cannot
//     write click rows for a site it does not belong to.

import type { SupabaseClient } from '@supabase/supabase-js';

const PLACEMENT_RE = /^[A-Za-z0-9_:.-]+$/;

export interface AffiliateIngestOptions {
  /** Site UUID this app owns — pinned on the server, never derived from the client payload. */
  siteId: string;
  /** Optional revenue source UUID to attribute these clicks to (e.g. the ebay_epn_* row). */
  sourceId?: string | null;
}

interface Body {
  event_type?:       unknown;
  placement?:        unknown;
  page_type?:        unknown;
  source_component?: unknown;
  card_slug?:        unknown;
  set_slug?:         unknown;
  intent?:           unknown;
  marketplace?:      unknown;
  session_id?:       unknown;
}

function asTrimmed(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function capped(v: unknown, max: number): string | null {
  const s = asTrimmed(v);
  if (s == null) return null;
  return s.length <= max ? s : s.slice(0, max);
}

export async function handleAffiliateEvent(
  req: Request,
  sb: SupabaseClient,
  opts: AffiliateIngestOptions,
): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const eventType = asTrimmed(body.event_type);
  if (eventType !== 'click') {
    // Phase 5 only persists clicks. Views are a future addition and
    // deliberately dropped silently so the client can be dumb.
    return Response.json({ ok: true, skipped: 'non_click' });
  }

  const placement = asTrimmed(body.placement);
  if (!placement || placement.length > 80 || !PLACEMENT_RE.test(placement)) {
    return Response.json({ error: 'placement required, <=80 chars, [A-Za-z0-9_:.-]' }, { status: 400 });
  }

  // Calls the SECURITY DEFINER RPC so this handler only needs the
  // caller's anon client — no service-role key is required or ever
  // transmitted. The RPC re-validates every argument server-side.
  const { error } = await sb.rpc('network_record_affiliate_click', {
    p_site_id:          opts.siteId,
    p_placement:        placement,
    p_source_id:        opts.sourceId ?? null,
    p_page_type:        capped(body.page_type,         40),
    p_source_component: capped(body.source_component,  80),
    p_card_slug:        capped(body.card_slug,         80),
    p_set_slug:         capped(body.set_slug,         200),
    p_intent:           capped(body.intent,            40),
    p_marketplace:      capped(body.marketplace,        8),
    p_session_id:       capped(body.session_id,        64),
  });
  if (error) {
    if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message)) {
      return Response.json({ error: 'network_record_affiliate_click RPC missing — apply Phase 5 follow-up migration' }, { status: 503 });
    }
    return Response.json({ error: 'insert failed' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
