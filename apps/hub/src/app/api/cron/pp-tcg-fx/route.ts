import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';

// PP-TCG-MIGRATE-04 §6: daily FX rate snapshot.
//
// Pulls USD<->EUR from the European Central Bank's free public
// reference-rate feed (no API key required, caches well). Writes
// one row per (as_of, base, quote) into pokemon_tcg_fx_rates.
// Idempotent — if today's row already exists, no-op.
//
// Zero TCGGraph credits used. Zero paid dependencies.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// open.er-api.com is a free no-auth aggregator. Response shape:
//   { result: 'success', rates: { EUR: 0.924, GBP: 0.788, ... }, time_last_update_utc: "..." }
// Keep SOURCES as an array so a secondary can be bolted on later
// without changing the main loop.
const SOURCES = [
  { url: 'https://open.er-api.com/v6/latest/USD', source: 'open.er-api.com' },
];

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  const sb = createServiceRoleSupabase();
  const today = new Date().toISOString().slice(0, 10);

  // Idempotency: already have today's row?
  const { count: existing } = await sb.from('pokemon_tcg_fx_rates')
    .select('id', { count: 'exact', head: true })
    .eq('as_of', today).eq('base', 'USD').eq('quote', 'EUR');
  if ((existing ?? 0) > 0) {
    return NextResponse.json({ ok: true, skipped: 'already_fetched', as_of: today });
  }

  let usdEur: number | null = null;
  let usedSource: string | null = null;
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url, { headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const j = (await r.json()) as any;
      // Normalise both shapes
      const rate = Number(j?.rates?.EUR);
      if (Number.isFinite(rate) && rate > 0) {
        usdEur = rate;
        usedSource = s.source;
        break;
      }
    } catch { /* try next */ }
  }

  if (usdEur == null) {
    return NextResponse.json({ ok: false, error: 'all FX sources failed' }, { status: 502 });
  }
  const eurUsd = 1 / usdEur;

  // Upsert both directions so the display helper doesn't have to
  // compute the inverse at render time.
  const rows = [
    { as_of: today, base: 'USD', quote: 'EUR', rate: Number(usdEur.toFixed(8)), source: usedSource },
    { as_of: today, base: 'EUR', quote: 'USD', rate: Number(eurUsd.toFixed(8)), source: usedSource },
    { as_of: today, base: 'USD', quote: 'USD', rate: 1, source: 'identity' },
    { as_of: today, base: 'EUR', quote: 'EUR', rate: 1, source: 'identity' },
  ];
  const { error } = await sb.from('pokemon_tcg_fx_rates').upsert(rows, { onConflict: 'as_of,base,quote' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, as_of: today, usd_eur: usdEur, eur_usd: eurUsd, source: usedSource });
}
