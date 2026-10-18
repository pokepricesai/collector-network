import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';

// PP-TCG-MIGRATE-02: daily credit-balance + heartbeat cron.
//
// A FULL Pokémon catalogue scan is ~1,138 credits + 570 requests
// and takes 4-5 minutes serially — tight for a 300s Vercel function.
// Rather than risk partial-success + lost state, the daily cron
// does a 1-credit heartbeat and records the current monthly credit
// balance in pokemon_tcg_ingestion_runs. The operator runs the FULL
// scan on demand via scripts/pp-tcg-migrate-01-ingest.mjs (local or
// a long-running worker).
//
// Also triggers an alert if monthly remaining drops below a safety
// threshold.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Percentage-based alert thresholds. First time monthly usage crosses
// each level in a given calendar month, we open a Hub alert. The dedupe
// key is month + threshold so we don't repeat.
const MONTHLY_LIMIT_DEFAULT = 150_000;
const THRESHOLDS: Array<{ pct: number; label: string }> = [
  { pct: 0.70, label: '70%' },
  { pct: 0.85, label: '85%' },
  { pct: 0.95, label: '95%' },
];
const LOW_CREDITS_WARN = 20_000;    // legacy; kept for the hard floor alert

function getApiKey(): string {
  const k = process.env.TCGGRAPH_API_KEY;
  if (!k) throw new Error('TCGGRAPH_API_KEY not set');
  return k;
}

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  const sb = createServiceRoleSupabase();
  const apiKey = getApiKey();

  const r = await fetch('https://api.tcggraph.com/v1/games/pokemon', {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
  });
  const remaining = Number(r.headers.get('x-credits-remaining'));
  const limit = Number(r.headers.get('x-credits-limit'));

  await sb.from('pokemon_tcg_ingestion_runs').insert({
    kind: 'repair',   // reusing enum; "healthcheck" is semantically what this is
    provider: 'tcggraph',
    state: r.status === 200 ? 'completed' : 'failed',
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    credits_spent: Number.isFinite(remaining) && Number.isFinite(limit) ? Math.max(0, limit - remaining - 0) : 1,
    requests_made: 1,
    error_message: r.status === 200 ? null : `heartbeat HTTP ${r.status}`,
    metadata: {
      kind_detail: 'healthcheck',
      monthly_remaining: Number.isFinite(remaining) ? remaining : null,
      monthly_limit: Number.isFinite(limit) ? limit : null,
    },
  });

  // Percentage-based alerts: 70% / 85% / 95% of monthly limit used.
  // Dedupe key is set_code='__CREDITS_<pct>_<YYYY-MM>' so we don't
  // re-open the same threshold alert each day within a month.
  if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0) {
    const used = limit - remaining;
    const usedPct = used / limit;
    const monthStamp = new Date().toISOString().slice(0, 7);
    for (const th of THRESHOLDS) {
      if (usedPct < th.pct) continue;
      const dedupeKey = `__CREDITS_${th.label}_${monthStamp}`;
      const { count } = await sb.from('pokemon_tcg_set_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('provider', 'tcggraph')
        .eq('tcg_set_code', dedupeKey);
      if ((count ?? 0) > 0) continue;
      await sb.from('pokemon_tcg_set_alerts').insert({
        provider: 'tcggraph',
        kind: 'card_count_changed',
        tcg_set_code: dedupeKey,
        tcg_set_name: `TCGGraph monthly credit usage hit ${th.label} (${used.toLocaleString()}/${limit.toLocaleString()})`,
        payload: { threshold_pct: th.pct, used, remaining, limit, month: monthStamp },
      });
    }
  }

  // Hard floor — legacy alert kept in case percentage-based math breaks
  if (Number.isFinite(remaining) && remaining < LOW_CREDITS_WARN) {
    const dedupeKey = `__CREDITS_FLOOR_${new Date().toISOString().slice(0,7)}`;
    const { count } = await sb.from('pokemon_tcg_set_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'tcggraph')
      .eq('tcg_set_code', dedupeKey);
    if ((count ?? 0) === 0) {
      await sb.from('pokemon_tcg_set_alerts').insert({
        provider: 'tcggraph', kind: 'card_count_changed',
        tcg_set_code: dedupeKey,
        tcg_set_name: `TCGGraph monthly remaining below floor ${LOW_CREDITS_WARN.toLocaleString()}`,
        payload: { monthly_remaining: remaining, monthly_limit: limit, floor: LOW_CREDITS_WARN },
      });
    }
  }

  return NextResponse.json({
    ok: r.status === 200,
    monthly_remaining: Number.isFinite(remaining) ? remaining : null,
    monthly_limit: Number.isFinite(limit) ? limit : null,
    note: 'full catalogue ingest runs via scripts/pp-tcg-migrate-01-ingest.mjs — not cron-scheduled due to 300s timeout risk',
  });
}
