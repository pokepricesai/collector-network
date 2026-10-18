import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';

// PP-TCG-MIGRATE-02: daily Pokémon set discovery cron.
//
// Enumerates /v1/sets?game=pokemon for both EN and JA, diffs
// against pokemon_tcg_sets_observed, inserts a fresh snapshot and
// opens pokemon_tcg_set_alerts for new/changed sets. Idempotent at
// row level (open-alert dedupe) and cheap (~9 credits/day).
//
// On the VERY FIRST run against an empty sets_observed table, we
// treat the observation as baseline rather than flooding the admin
// with ~683 "new_set" alerts. Subsequent runs alert normally.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const CREDIT_CAP = 50;

function getApiKey(): string {
  const k = process.env.TCGGRAPH_API_KEY;
  if (!k) throw new Error('TCGGRAPH_API_KEY not set');
  return k;
}

interface TcgSet { code: string; name: string; language: string; releasedAt: string | null; cards: number | null; counts?: { printings?: number } }

async function fetchSetsForLang(lang: string, apiKey: string, tracker: { credits: number; requests: number }): Promise<TcgSet[]> {
  const all: TcgSet[] = [];
  let page = 1;
  while (true) {
    if (tracker.credits >= CREDIT_CAP) throw new Error('credit cap');
    const url = new URL('https://api.tcggraph.com/v1/sets');
    url.searchParams.set('game', 'pokemon');
    url.searchParams.set('language', lang);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '100');
    tracker.requests += 1;
    const r = await fetch(url.href, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });
    const cost = Number(r.headers.get('x-credits-cost'));
    tracker.credits += Number.isFinite(cost) && cost > 0 ? cost : 1;
    if (r.status !== 200) throw new Error(`sets ${lang} p${page}: ${r.status}`);
    const b = (await r.json().catch(() => null)) as { data?: TcgSet[]; meta?: { hasMore?: boolean } };
    const rows = b?.data ?? [];
    all.push(...rows);
    if (!b?.meta?.hasMore || rows.length === 0) break;
    page += 1;
    if (page > 20) break;
  }
  return all;
}

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  const sb = createServiceRoleSupabase();
  const tracker = { credits: 0, requests: 0 };

  const { data: run, error: rErr } = await sb.from('pokemon_tcg_ingestion_runs').insert({
    kind: 'set_discovery', provider: 'tcggraph', state: 'running',
  }).select('id').single();
  if (rErr || !run) return NextResponse.json({ ok: false, error: `run insert: ${rErr?.message ?? '?'}` }, { status: 500 });

  const finish = async (state: 'completed' | 'failed', extra: Record<string, unknown>) =>
    sb.from('pokemon_tcg_ingestion_runs').update({
      state, finished_at: new Date().toISOString(),
      credits_spent: tracker.credits, requests_made: tracker.requests, ...extra,
    }).eq('id', run.id);

  try {
    const apiKey = getApiKey();
    const [enSets, jaSets] = await Promise.all([
      fetchSetsForLang('en', apiKey, tracker),
      fetchSetsForLang('ja', apiKey, tracker),
    ]);
    const observed = [...enSets, ...jaSets];
    const observed_at = new Date().toISOString();

    // Was sets_observed empty before this run? Then this is the baseline.
    const { count: priorCount } = await sb.from('pokemon_tcg_sets_observed')
      .select('id', { count: 'exact', head: true });
    const isBaseline = (priorCount ?? 0) === 0;

    const { data: lastRows } = await sb
      .from('pokemon_tcg_sets_observed')
      .select('tcg_set_code, tcg_set_name, tcg_language, released_at, card_count, observed_at')
      .order('observed_at', { ascending: false });
    const lastByCode = new Map<string, { card_count: number | null; released_at: string | null }>();
    for (const r of (lastRows || [])) {
      if (!lastByCode.has(r.tcg_set_code)) lastByCode.set(r.tcg_set_code, r as any);
    }

    const seen = new Set<string>();
    const toInsert: Array<Record<string, unknown>> = [];
    for (const o of observed) {
      const k = `${o.code}|${observed_at}`;
      if (seen.has(k)) continue;
      seen.add(k);
      toInsert.push({
        provider: 'tcggraph',
        tcg_set_code: o.code,
        tcg_set_name: o.name,
        tcg_language: o.language,
        released_at: o.releasedAt ?? null,
        card_count: o.cards ?? null,
        printing_count: o.counts?.printings ?? null,
        observed_at,
      });
    }

    const BATCH = 500;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
      const { error } = await sb.from('pokemon_tcg_sets_observed').upsert(chunk, {
        onConflict: 'provider,tcg_set_code,observed_at',
      });
      if (error) throw new Error(`snapshot: ${error.message}`);
    }

    let opened = 0;
    if (!isBaseline) {
      for (const o of observed) {
        const prev = lastByCode.get(o.code);
        const alerts: Array<{ kind: string; payload: Record<string, unknown> }> = [];
        if (!prev) {
          alerts.push({ kind: 'new_set', payload: { released_at: o.releasedAt, card_count: o.cards } });
        } else {
          if ((prev.card_count ?? null) !== (o.cards ?? null)) alerts.push({ kind: 'card_count_changed', payload: { previous: prev.card_count, current: o.cards } });
          if ((prev.released_at ?? null) !== (o.releasedAt ?? null)) alerts.push({ kind: 'release_date_changed', payload: { previous: prev.released_at, current: o.releasedAt } });
        }
        for (const a of alerts) {
          const { count } = await sb.from('pokemon_tcg_set_alerts').select('id', { count: 'exact', head: true })
            .eq('provider', 'tcggraph').eq('kind', a.kind).eq('tcg_set_code', o.code).is('acknowledged_at', null);
          if ((count ?? 0) > 0) continue;
          const { error: alErr } = await sb.from('pokemon_tcg_set_alerts').insert({
            provider: 'tcggraph', kind: a.kind,
            tcg_set_code: o.code, tcg_set_name: o.name, tcg_language: o.language,
            payload: a.payload,
          });
          if (!alErr) opened += 1;
        }
      }
    }

    await finish('completed', {
      sets_observed: observed.length,
      alerts_opened: opened,
      metadata: { is_baseline: isBaseline },
    });

    return NextResponse.json({
      ok: true,
      run_id: run.id,
      is_baseline: isBaseline,
      en_sets: enSets.length,
      ja_sets: jaSets.length,
      alerts_opened: opened,
      credits_spent: tracker.credits,
    });
  } catch (e) {
    const msg = (e as Error).message;
    await finish('failed', { error_message: msg });
    return NextResponse.json({ ok: false, error: msg, run_id: run.id, credits_spent: tracker.credits }, { status: 500 });
  }
}
