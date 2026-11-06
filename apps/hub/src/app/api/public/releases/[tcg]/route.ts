import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CN-06.06 · Shared public release-calendar feed.
//
// GET /api/public/releases/[tcg]
//   tcg ∈ { pokemon, mtg, ygo, onepiece, lorcana }
//
// Consumed by each of the five public sites (/releases page +
// optional "Upcoming releases" homepage widget). Returns a bounded
// payload — upcoming (today → +180d) + recently released
// (today-30d → today) — so the sites render a complete calendar
// without per-site Supabase query logic.
//
// Caching:
//   * 15-min s-maxage with 24h stale-while-revalidate on Vercel's
//     CDN. Chosen so an operator approval reaches the public feed
//     within ~15 minutes, not 24 hours. The underlying view is
//     small (dozens of rows per TCG), so a cold refetch is cheap
//     and the per-site /releases pages revalidate on the same
//     cadence (next.revalidate = 900s).
//   * stale-while-revalidate=86400 keeps the CDN serving the last
//     good response for up to 24 hours if the origin is down,
//     without blocking user-visible latency on revalidation.
//
// Data source:
//   * network_tcg_releases_public view (anon-readable,
//     operator-only columns stripped, filtered to
//     confirmation_status ∈ {confirmed, announced_tbc, postponed,
//     released}).
//
// Security:
//   * Public endpoint — no auth. Only exposes data already
//     cleared for public consumption by the view's column
//     projection.
//   * No service-role key used. Anon key only.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';   // we cache via headers, not Next
export const revalidate = 0;

type Tcg = 'pokemon' | 'mtg' | 'ygo' | 'onepiece' | 'lorcana';
const VALID_TCGS: Tcg[] = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'];

interface PublicReleaseRow {
  id: string;
  tcg: Tcg;
  site_slug: Tcg;
  set_name: string;
  set_name_translated: string | null;
  translation_official: boolean;
  set_code: string | null;
  product_type: string;
  language: 'en' | 'ja' | 'other';
  region: string | null;
  release_date: string | null;
  release_date_precision: 'day' | 'month' | 'tbc';
  prerelease_date: string | null;
  confirmation_status: 'confirmed' | 'announced_tbc' | 'postponed' | 'released';
  source_url: string | null;
  site_set_url: string | null;
  previous_release_date: string | null;
  date_changed_at: string | null;
  updated_at: string;
}

function sanitize(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/^﻿/, '').replace(/^"|"$/g, '').trim();
}

function anonClient() {
  const url = sanitize(process.env['NEXT_PUBLIC_SUPABASE_URL']);
  const key = sanitize(process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY']);
  if (!url || !key) throw new Error('[releases/public] Supabase anon env missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ tcg: string }> },
) {
  const { tcg: rawTcg } = await context.params;
  const tcg = rawTcg.toLowerCase();
  if (!(VALID_TCGS as string[]).includes(tcg)) {
    return NextResponse.json(
      { ok: false, error: `unknown tcg '${rawTcg}' — expected one of ${VALID_TCGS.join(', ')}` },
      { status: 400 },
    );
  }

  const sb = anonClient();
  const today = new Date();
  const dayMs = 86_400_000;
  const todayIso = today.toISOString().slice(0, 10);
  const recent30 = new Date(today.getTime() - 30 * dayMs).toISOString().slice(0, 10);
  const horizon180 = new Date(today.getTime() + 180 * dayMs).toISOString().slice(0, 10);

  // Upcoming (today → +180d) across confirmed / announced_tbc /
  // postponed. We order by nullsLast so TBC-dated rows sort after
  // confirmed rows within the same month.
  const upcomingQ = sb
    .from('network_tcg_releases_public')
    .select('*')
    .eq('tcg', tcg)
    .in('confirmation_status', ['confirmed', 'announced_tbc', 'postponed'])
    .or(`release_date.gte.${todayIso},release_date.is.null`)
    .lte('release_date', horizon180)
    .order('release_date', { ascending: true, nullsFirst: false })
    .limit(200);

  // Recently released (last 30d). Only released status — a
  // 'confirmed' row whose date has passed should have been swept
  // to 'released' by the 04:50 UTC daily sweep; if not, we leave
  // it in upcoming so the inconsistency is visible to the
  // operator rather than hidden.
  const recentQ = sb
    .from('network_tcg_releases_public')
    .select('*')
    .eq('tcg', tcg)
    .eq('confirmation_status', 'released')
    .gte('release_date', recent30)
    .lte('release_date', todayIso)
    .order('release_date', { ascending: false })
    .limit(50);

  const [upRes, recRes] = await Promise.all([upcomingQ, recentQ]);
  if (upRes.error || recRes.error) {
    return NextResponse.json(
      {
        ok: false,
        error: upRes.error?.message ?? recRes.error?.message ?? 'unknown Supabase error',
      },
      { status: 500 },
    );
  }

  const upcoming = (upRes.data ?? []) as PublicReleaseRow[];
  const recently_released = (recRes.data ?? []) as PublicReleaseRow[];

  return NextResponse.json(
    {
      ok: true,
      tcg,
      generated_at: new Date().toISOString(),
      counts: {
        upcoming: upcoming.length,
        recently_released: recently_released.length,
      },
      upcoming,
      recently_released,
    },
    {
      status: 200,
      headers: {
        // 24h CDN cache + 7d stale-while-revalidate. Sites
        // re-fetch on their own revalidate cadence; the CDN
        // amortises Supabase load across all consumers.
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=86400',
        'Content-Type': 'application/json',
      },
    },
  );
}
