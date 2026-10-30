// OnePiecePrices affiliate-click ingest.
//
// Clone of the YGO route (apps/yugioh/src/app/api/affiliate/event).
// Fire-and-forget endpoint called by the shared browser beacon in
// @collector-network/affiliate-tracking/client. Writes one row to
// public.network_affiliate_clicks on the shared Collector Network
// Supabase project via the SECURITY DEFINER RPC
// `network_record_affiliate_click`. No service-role key is used.
//
// Privacy: no IP, no User-Agent, no Referer, no email, no user_id.
// See handleAffiliateEvent in @collector-network/affiliate-tracking/server.

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { handleAffiliateEvent } from '@collector-network/affiliate-tracking/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SB_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
const SB_ANON = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY'];

// Site pin — this app writes clicks only for the OnePiece site row.
const OP_SITE_ID = 'f5267940-500b-4f1e-b17f-f49fbf605d3c';

export async function POST(req: Request) {
  if (!SB_URL || !SB_ANON) {
    return Response.json({ error: 'supabase env missing' }, { status: 503 });
  }
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  return handleAffiliateEvent(req, sb, { siteId: OP_SITE_ID });
}
