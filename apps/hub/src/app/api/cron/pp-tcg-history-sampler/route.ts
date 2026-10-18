import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';

// PP-TCG-MIGRATE-04 §3: affordable history growth.
//
// Daily job. For the top-N GSC commercial-rank cards that still
// need more historical coverage, pull /v1/prices/{id}/history
// (3 cr per call) and merge into pokemon_tcg_prices_history.
// Budget-capped so monthly history growth stays trivial relative
// to the 150k-credit allowance.
//
// Priorities:
//   1. GSC-ranked bulk_safe + market_only cards (operator-visible)
//   2. Cards with zero history points so far
//   3. Cards whose newest history point is older than REFRESH_AFTER_DAYS
//
// Why this is cheap: the daily catalogue ingestion already grows
// one new daily snapshot per card at zero marginal cost per day.
// This cron adds the HISTORICAL backfill for the top cohort only.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const DAILY_SAMPLE_SIZE = 20;         // 20 cards × 3 cr = 60 cr/day
const REFRESH_AFTER_DAYS = 30;
const CREDIT_FLOOR = 10_000;

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
  const tracker = { credits: 0, requests: 0 };

  const { data: run } = await sb.from('pokemon_tcg_ingestion_runs').insert({
    kind: 'history_batch', provider: 'tcggraph', state: 'running',
    metadata: { kind_detail: 'daily_sampler' },
  }).select('id').single();
  if (!run) return NextResponse.json({ ok: false, error: 'run insert failed' }, { status: 500 });

  const finish = async (state: 'completed' | 'failed', extra: Record<string, unknown> = {}) => {
    await sb.from('pokemon_tcg_ingestion_runs').update({
      state, finished_at: new Date().toISOString(),
      credits_spent: tracker.credits, requests_made: tracker.requests, ...extra,
    }).eq('id', run.id);
  };

  // Preflight: check credit floor
  try {
    const r = await fetch('https://api.tcggraph.com/v1/games/pokemon', {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });
    const remaining = Number(r.headers.get('x-credits-remaining'));
    tracker.credits += 1; tracker.requests += 1;
    if (Number.isFinite(remaining) && remaining < CREDIT_FLOOR) {
      await finish('completed', { metadata: { skipped: 'credit_floor', monthly_remaining: remaining } });
      return NextResponse.json({ ok: true, skipped: 'credit_floor', monthly_remaining: remaining });
    }
  } catch { /* non-fatal */ }

  // Pick targets: top GSC commercial cards with eligibility bulk_safe
  // or market_only, approved OR verified, missing or stale history.
  const { data: targets, error: tErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('tcg_card_id, tcg_printing_key, pp_card_slug, pp_card_name, commercial_rank, pricing_eligibility')
    .eq('provider', 'tcggraph')
    .in('pricing_eligibility', ['bulk_safe', 'market_only'])
    .not('tcg_card_id', 'is', null)
    .not('commercial_rank', 'is', null)
    .order('commercial_rank', { ascending: true })
    .limit(500);
  if (tErr) {
    await finish('failed', { error_message: `targets: ${tErr.message}` });
    return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
  }

  // Of those, pick ones with no or stale history
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86400_000).toISOString().slice(0, 10);
  const picks: Array<{ tcg_card_id: string; tcg_printing_key: string; slug: string; rank: number | null }> = [];
  for (const t of (targets ?? []) as any[]) {
    if (picks.length >= DAILY_SAMPLE_SIZE) break;
    // Lightweight check: is there a history point newer than cutoff?
    const { count } = await sb.from('pokemon_tcg_prices_history')
      .select('id', { count: 'exact', head: true })
      .eq('tcg_card_id', t.tcg_card_id)
      .gt('day', cutoff);
    if ((count ?? 0) > 0) continue;
    picks.push({
      tcg_card_id: t.tcg_card_id,
      tcg_printing_key: t.tcg_printing_key || 'normal',
      slug: t.pp_card_slug,
      rank: t.commercial_rank,
    });
  }

  if (picks.length === 0) {
    await finish('completed', { metadata: { note: 'nothing to sample today' } });
    return NextResponse.json({ ok: true, picked: 0, note: 'top-ranked cards all have fresh history' });
  }

  // Fetch history
  const historyRows: Array<Record<string, unknown>> = [];
  for (const p of picks) {
    const u = new URL(`https://api.tcggraph.com/v1/prices/${encodeURIComponent(p.tcg_card_id)}/history`);
    const r = await fetch(u.toString(), { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' } });
    const cost = Number(r.headers.get('x-credits-cost'));
    tracker.credits += Number.isFinite(cost) && cost > 0 ? cost : 3;
    tracker.requests += 1;
    if (r.status !== 200) continue;
    const body = (await r.json().catch(() => null)) as any;
    const data = body?.data;
    if (!data) continue;
    const kind = data.grader ? 'graded' : 'market';
    for (const point of (data.points ?? [])) {
      historyRows.push({
        provider: 'tcggraph',
        tcg_card_id: data.cardId,
        tcg_printing_key: p.tcg_printing_key,
        series_kind: kind,
        source: data.source ?? null,
        finish: data.finish ?? null,
        grader: data.grader ?? null,
        grade: data.grade ? String(data.grade) : null,
        currency: point.currency || 'USD',
        day: point.day,
        market: point.market ?? null,
        low: point.low ?? null,
      });
    }
  }

  // Idempotent upsert
  const seen = new Set<string>();
  const dedup = historyRows.filter(r => {
    const k = ['provider','tcg_card_id','tcg_printing_key','series_kind','source','finish','grader','grade','day']
      .map(c => String(r[c as keyof typeof r] ?? '∅')).join('|');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  const BATCH = 500;
  for (let i = 0; i < dedup.length; i += BATCH) {
    const chunk = dedup.slice(i, i + BATCH);
    const { error } = await sb.from('pokemon_tcg_prices_history').upsert(chunk, {
      onConflict: 'provider,tcg_card_id,tcg_printing_key,series_kind,source,finish,grader,grade,day',
    });
    if (error) {
      await finish('failed', { error_message: `history upsert: ${error.message}` });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  await finish('completed', {
    metadata: {
      kind_detail: 'daily_sampler',
      picks: picks.map(p => ({ slug: p.slug, rank: p.rank, tcg: p.tcg_card_id })),
      history_points: dedup.length,
    },
  });

  return NextResponse.json({
    ok: true,
    picked: picks.length,
    history_points: dedup.length,
    credits_spent: tracker.credits,
    requests: tracker.requests,
  });
}
