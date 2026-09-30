// /api/revalidate — cache invalidation endpoint used by the ingest
// pipeline (mtgprices-web) to force-expire YGO Data Cache tags after a
// successful price refresh.
//
// Contract:
//   POST /api/revalidate
//   Authorization: Bearer <YGO_REVALIDATE_TOKEN>
//   Body: { "tags": ["ygo:market", ...] }
//
// Returns 200 with { revalidated } on success, 400 on missing/invalid
// body, 401 on auth failure. Idempotent.
//
// This endpoint intentionally does not compute freshness itself — the
// caller decides when to invalidate. The frontend does not depend on
// this route; it is a push-based hint from the ingest layer to keep
// cache staleness bounded (~seconds after ingest completes) instead of
// waiting on the 6h Data Cache TTL to expire naturally.

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whitelist of tags this endpoint is willing to revalidate. Keeps a
// leaked secret from being weaponised into a cache-storm attack on
// arbitrary tag namespaces.
const ALLOWED_TAGS = new Set<string>([
  'ygo:market',
  'ygo:entity',
  'ygo:taxonomy',
  'ygo:fnl',
  'ygo:card',
  'ygo:sitemap',
]);

function isAuthorised(req: Request): boolean {
  const secret = process.env['YGO_REVALIDATE_TOKEN'];
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const tags = (body as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(tags) || tags.length === 0) {
    return NextResponse.json({ ok: false, error: 'tags_required' }, { status: 400 });
  }
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const raw of tags) {
    const tag = typeof raw === 'string' ? raw.trim() : '';
    if (tag && ALLOWED_TAGS.has(tag)) {
      revalidateTag(tag);
      accepted.push(tag);
    } else if (tag) {
      rejected.push(tag);
    }
  }
  return NextResponse.json({
    ok: true,
    revalidated: accepted,
    rejected,
  });
}
