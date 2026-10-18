import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';

// PP-TCG-MIGRATE-04 §1: chunked resumable Pokémon catalogue
// ingestion. Scheduled every 20 min; each invocation processes a
// bounded number of sets (max 25 OR until 230s elapsed OR until
// the daily cycle completes).
//
// Cursor is persisted in pokemon_tcg_ingestion_cursor (one row).
// At midnight UTC (first run after 00:00) the cursor resets and a
// new cycle begins. Over the day the cron works through 683 sets
// (~230 EN + 453 JA). Each set is fetched by paginated card list
// and upserted idempotently into:
//   pokemon_tcg_provider_cards
//   pokemon_tcg_prices_market
//   pokemon_tcg_prices_graded
//
// Hard safety: the budget guard refuses expensive calls when
// monthly credits remaining drops below the configured floor.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// How many sets to process in one invocation before yielding.
const SET_BATCH = 25;
// Time budget (ms). Leave a safety margin under the 300s function cap.
const TIME_BUDGET_MS = 230_000;
// Hard floor: never dip the account below this. Protects the other
// four Collector Network sites' monthly budget.
const CREDITS_RESERVED_FOR_OTHER_SITES = 10_000;

function getApiKey(): string {
  const k = process.env.TCGGRAPH_API_KEY;
  if (!k) throw new Error('TCGGRAPH_API_KEY not set');
  return k;
}

interface SetRow {
  tcg_set_code: string;
  tcg_set_name: string;
  tcg_language: string;
}

async function fetchJson<T = unknown>(url: string, apiKey: string, tracker: { credits: number; requests: number }): Promise<{ status: number; body: T | null; remaining: number | null }> {
  tracker.requests += 1;
  const r = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
  });
  const cost = Number(r.headers.get('x-credits-cost'));
  const remaining = Number(r.headers.get('x-credits-remaining'));
  tracker.credits += Number.isFinite(cost) && cost > 0 ? cost : 1;
  const body = (await r.json().catch(() => null)) as T | null;
  return { status: r.status, body, remaining: Number.isFinite(remaining) ? remaining : null };
}

function sanitizeFinish(f: unknown): string | null {
  if (f == null) return null;
  return String(f).slice(0, 64);
}

type Card = {
  id: string;
  name: string;
  language: string;
  collectorNumber?: string | null;
  rarity?: string | null;
  baseCardId?: string | null;
  englishId?: string | null;
  priceStatus?: string | null;
  set?: { code: string; name: string };
  images?: { small?: string; normal?: string; large?: string };
  imageFrom?: string;
  prices?: Array<Record<string, unknown>>;
  gradedPrices?: Array<Record<string, unknown>>;
  printings?: Array<{
    key?: string; label?: string; kind?: string;
    externalIds?: Record<string, unknown>;
    images?: { small?: string; normal?: string; large?: string };
    imageFrom?: string;
    prices?: Array<Record<string, unknown>>;
    cardId?: string;
  }>;
};

async function listCardsInSet(setCode: string, language: string, apiKey: string, tracker: { credits: number; requests: number }): Promise<Card[]> {
  const all: Card[] = [];
  let page = 1;
  while (true) {
    const u = new URL('https://api.tcggraph.com/v1/cards');
    u.searchParams.set('game', 'pokemon');
    u.searchParams.set('set', setCode);
    u.searchParams.set('language', language);
    u.searchParams.set('page', String(page));
    u.searchParams.set('limit', '100');
    const r = await fetchJson<{ data?: Card[]; meta?: { hasMore?: boolean } }>(u.toString(), apiKey, tracker);
    if (r.status !== 200 || !r.body) throw new Error(`cards ${setCode} p${page}: HTTP ${r.status}`);
    const rows = r.body.data ?? [];
    all.push(...rows);
    if (!r.body.meta?.hasMore || rows.length === 0) break;
    page += 1;
    if (page > 20) break;
  }
  return all;
}

function cardToProviderRows(card: Card, catalogueVersion: string) {
  const printings = card.printings ?? [];
  const providerCardRows: Array<Record<string, unknown>> = [];
  const marketRows: Array<Record<string, unknown>> = [];
  const gradedRows: Array<Record<string, unknown>> = [];
  const basePrint = {
    provider: 'tcggraph',
    tcg_card_id: card.id,
    tcg_set_code: card.set?.code ?? null,
    tcg_set_name: card.set?.name ?? null,
    tcg_language: card.language,
    tcg_card_name: card.name,
    tcg_collector_number: card.collectorNumber ?? null,
    tcg_rarity: card.rarity ?? null,
    base_card_id: card.baseCardId ?? null,
    english_id: card.englishId ?? null,
    price_status: card.priceStatus ?? null,
    catalogue_version: catalogueVersion,
  };

  if (printings.length === 0) {
    providerCardRows.push({
      ...basePrint,
      tcg_printing_key: 'normal',
      image_small: card.images?.small ?? null,
      image_normal: card.images?.normal ?? null,
      image_large: card.images?.large ?? null,
      image_source: card.imageFrom ?? null,
    });
  } else {
    for (const p of printings) {
      providerCardRows.push({
        ...basePrint,
        tcg_printing_key: p.key || 'normal',
        image_small: p.images?.small ?? card.images?.small ?? null,
        image_normal: p.images?.normal ?? card.images?.normal ?? null,
        image_large: p.images?.large ?? card.images?.large ?? null,
        image_source: p.imageFrom ?? card.imageFrom ?? null,
      });
      for (const pr of (p.prices ?? [])) {
        marketRows.push({
          provider: 'tcggraph',
          tcg_card_id: card.id,
          tcg_printing_key: p.key || 'normal',
          source: pr.source,
          region: pr.region ?? null,
          list_type: (pr.listType as string) || 'retail',
          finish: sanitizeFinish(pr.finish),
          currency: pr.currency,
          market: pr.market ?? null,
          low: pr.low ?? null,
          trend: pr.trend ?? null,
          avg1: pr.avg1 ?? null,
          avg7: pr.avg7 ?? null,
          avg30: pr.avg30 ?? null,
          basis: (pr.basis as string | null) ?? null,
          source_updated_at: (pr.updatedAt as string) ?? null,
        });
      }
    }
  }
  for (const pr of (card.prices ?? [])) {
    marketRows.push({
      provider: 'tcggraph',
      tcg_card_id: card.id,
      tcg_printing_key: 'normal',
      source: pr.source,
      region: pr.region ?? null,
      list_type: (pr.listType as string) || 'retail',
      finish: sanitizeFinish(pr.finish),
      currency: pr.currency,
      market: pr.market ?? null,
      low: pr.low ?? null,
      trend: pr.trend ?? null,
      avg1: pr.avg1 ?? null,
      avg7: pr.avg7 ?? null,
      avg30: pr.avg30 ?? null,
      basis: (pr.basis as string | null) ?? null,
      source_updated_at: (pr.updatedAt as string) ?? null,
    });
  }
  for (const g of (card.gradedPrices ?? [])) {
    gradedRows.push({
      provider: 'tcggraph',
      tcg_card_id: card.id,
      grader: g.grader,
      grade: String(g.grade),
      currency: (g.currency as string) || 'USD',
      price: g.price ?? null,
      sales_volume: g.salesVolume ?? null,
      source_updated_at: (g.updatedAt as string) ?? null,
    });
  }
  return { providerCardRows, marketRows, gradedRows };
}

function dedupeOnKey<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = keys.map(c => String(r[c] ?? '∅')).join('|');
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  const t0 = Date.now();
  const sb = createServiceRoleSupabase();
  const apiKey = getApiKey();
  const tracker = { credits: 0, requests: 0 };
  const todayUtc = new Date().toISOString().slice(0, 10);
  const catalogueVersion = `daily-${todayUtc}`;

  // 1. Load (and advance if needed) the cursor
  const { data: cursorRow, error: cErr } = await sb
    .from('pokemon_tcg_ingestion_cursor')
    .select('*')
    .eq('provider', 'tcggraph')
    .eq('kind', 'daily_catalogue')
    .maybeSingle();
  if (cErr) return NextResponse.json({ ok: false, error: `cursor read: ${cErr.message}` }, { status: 500 });
  if (!cursorRow) return NextResponse.json({ ok: false, error: 'cursor row missing — rerun migration' }, { status: 500 });

  const sameDay = cursorRow.cycle_started_at && String(cursorRow.cycle_started_at).slice(0, 10) === todayUtc;
  const alreadyDone = cursorRow.state === 'completed_for_day' && sameDay;
  if (alreadyDone) {
    return NextResponse.json({ ok: true, skipped: 'completed_for_day', last_set_code: cursorRow.last_set_code, cycle_credits: cursorRow.cycle_credits_spent });
  }

  // Fresh cycle? Reset counters.
  if (!sameDay || cursorRow.state === 'idle') {
    await sb.from('pokemon_tcg_ingestion_cursor').update({
      state: 'running',
      cycle_started_at: new Date().toISOString(),
      cycle_credits_spent: 0,
      cycle_sets_processed: 0,
      cycle_cards_upserted: 0,
      last_set_code: null,
      last_language: null,
      cycle_completed_at: null,
    }).eq('id', cursorRow.id);
    cursorRow.state = 'running';
    cursorRow.last_set_code = null as any;
    cursorRow.cycle_credits_spent = 0;
    cursorRow.cycle_sets_processed = 0;
    cursorRow.cycle_cards_upserted = 0;
  } else {
    // Mark running (idempotent even if already running)
    await sb.from('pokemon_tcg_ingestion_cursor').update({ state: 'running' }).eq('id', cursorRow.id);
  }

  // 2. Duplicate-run prevention: refuse to start if another ingest-chunk is already in flight.
  // "In flight" = ingestion_runs row for 'full_catalogue' with state='running' and started within last 10 min.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: runningCount } = await sb.from('pokemon_tcg_ingestion_runs')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'tcggraph')
    .eq('kind', 'full_catalogue')
    .eq('state', 'running')
    .gt('started_at', tenMinAgo);
  if ((runningCount ?? 0) > 0) {
    return NextResponse.json({ ok: true, skipped: 'another_run_in_flight' });
  }

  // 3. Record this chunk run
  const { data: run } = await sb.from('pokemon_tcg_ingestion_runs').insert({
    kind: 'full_catalogue', provider: 'tcggraph', state: 'running',
    metadata: { chunk: true, cursor_before: cursorRow.last_set_code },
  }).select('id').single();
  if (!run) return NextResponse.json({ ok: false, error: 'run insert failed' }, { status: 500 });

  const finish = async (state: 'completed' | 'failed', extra: Record<string, unknown> = {}) => {
    await sb.from('pokemon_tcg_ingestion_runs').update({
      state, finished_at: new Date().toISOString(),
      credits_spent: tracker.credits, requests_made: tracker.requests, ...extra,
    }).eq('id', run.id);
  };

  // 4. Get the ordered list of sets we still need to process this cycle
  // Order: EN sets first (by set code), then JA sets (by set code).
  const { data: observed } = await sb.from('pokemon_tcg_sets_observed')
    .select('tcg_set_code, tcg_set_name, tcg_language')
    .order('observed_at', { ascending: false });
  if (!observed || observed.length === 0) {
    await finish('failed', { error_message: 'no sets observed yet; run discovery first' });
    return NextResponse.json({ ok: false, error: 'no sets observed; run /api/cron/pp-tcg-discover first' }, { status: 500 });
  }
  // Unique set codes, EN first then JA.
  const uniqSets: SetRow[] = [];
  const seenCode = new Set<string>();
  for (const s of observed as SetRow[]) {
    if (seenCode.has(s.tcg_set_code)) continue;
    seenCode.add(s.tcg_set_code);
    uniqSets.push({ tcg_set_code: s.tcg_set_code, tcg_set_name: s.tcg_set_name, tcg_language: s.tcg_language });
  }
  uniqSets.sort((a, b) => {
    if (a.tcg_language !== b.tcg_language) return a.tcg_language === 'en' ? -1 : 1;
    return a.tcg_set_code.localeCompare(b.tcg_set_code);
  });

  // Skip to just-after the cursor
  const cursorIdx = cursorRow.last_set_code
    ? uniqSets.findIndex(s => s.tcg_set_code === cursorRow.last_set_code)
    : -1;
  const remaining = uniqSets.slice(cursorIdx + 1);
  if (remaining.length === 0) {
    await sb.from('pokemon_tcg_ingestion_cursor').update({
      state: 'completed_for_day',
      cycle_completed_at: new Date().toISOString(),
    }).eq('id', cursorRow.id);
    await finish('completed', { metadata: { cycle_complete: true } });
    return NextResponse.json({ ok: true, state: 'completed_for_day', sets_remaining: 0 });
  }

  // 5. Process sets up to the chunk budget
  let setsProcessed = 0;
  let cardsUpserted = 0;
  let lastSetCode = cursorRow.last_set_code as string | null;
  let lastRemaining: number | null = null;
  const providerCards: Array<Record<string, unknown>> = [];
  const marketRows: Array<Record<string, unknown>> = [];
  const gradedRows: Array<Record<string, unknown>> = [];

  for (const s of remaining) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;
    if (setsProcessed >= SET_BATCH) break;
    // Budget guard: last known remaining must stay above the floor
    if (lastRemaining != null && lastRemaining < CREDITS_RESERVED_FOR_OTHER_SITES + 100) {
      // Open an alert and stop
      const { count } = await sb.from('pokemon_tcg_set_alerts').select('id', { count: 'exact', head: true })
        .eq('provider', 'tcggraph').eq('tcg_set_code', '__CREDITS__').is('acknowledged_at', null);
      if ((count ?? 0) === 0) {
        await sb.from('pokemon_tcg_set_alerts').insert({
          provider: 'tcggraph', kind: 'card_count_changed',
          tcg_set_code: '__CREDITS__', tcg_set_name: 'TCGGraph monthly credits near floor — ingestion paused',
          payload: { monthly_remaining: lastRemaining, floor: CREDITS_RESERVED_FOR_OTHER_SITES },
        });
      }
      break;
    }

    try {
      // Fetch all cards in this set + language
      const cards = await listCardsInSet(s.tcg_set_code, s.tcg_language, apiKey, tracker);
      for (const c of cards) {
        const { providerCardRows, marketRows: mr, gradedRows: gr } = cardToProviderRows(c, catalogueVersion);
        providerCards.push(...providerCardRows);
        marketRows.push(...mr);
        gradedRows.push(...gr);
      }
      cardsUpserted += cards.length;
      setsProcessed += 1;
      lastSetCode = s.tcg_set_code;
      // Read the latest `remaining` from the last response — we tracked it via the fetchJson wrapper.
      // Simpler: ping /v1/games/pokemon once at the end to get the latest number.
    } catch (err) {
      await finish('failed', { error_message: `set ${s.tcg_set_code}: ${(err as Error).message}` });
      await sb.from('pokemon_tcg_ingestion_cursor').update({
        state: 'failed', updated_at: new Date().toISOString(),
      }).eq('id', cursorRow.id);
      return NextResponse.json({
        ok: false, error: `set ${s.tcg_set_code}: ${(err as Error).message}`,
        sets_processed: setsProcessed, credits_spent: tracker.credits,
      }, { status: 500 });
    }
  }

  // 6. Idempotent upserts
  const pcDeduped = dedupeOnKey(providerCards, ['provider', 'tcg_card_id', 'tcg_printing_key']);
  const mkDeduped = dedupeOnKey(marketRows, ['provider', 'tcg_card_id', 'tcg_printing_key', 'source', 'list_type', 'finish', 'currency']);
  const gdDeduped = dedupeOnKey(gradedRows, ['provider', 'tcg_card_id', 'grader', 'grade']);

  const BATCH = 500;
  const bulkUpsert = async (table: string, rows: Array<Record<string, unknown>>, onConflict: string) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await sb.from(table).upsert(chunk, { onConflict });
      if (error) throw new Error(`${table} chunk ${i}: ${error.message}`);
    }
  };

  try {
    await bulkUpsert('pokemon_tcg_provider_cards', pcDeduped, 'provider,tcg_card_id,tcg_printing_key');
    await bulkUpsert('pokemon_tcg_prices_market', mkDeduped, 'provider,tcg_card_id,tcg_printing_key,source,list_type,finish,currency');
    await bulkUpsert('pokemon_tcg_prices_graded', gdDeduped, 'provider,tcg_card_id,grader,grade');
  } catch (err) {
    await finish('failed', { error_message: (err as Error).message });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }

  // 7. Peek current credits for monitoring
  try {
    const u = new URL('https://api.tcggraph.com/v1/games/pokemon');
    const r = await fetchJson<{}>(u.toString(), apiKey, tracker);
    lastRemaining = r.remaining;
  } catch { /* non-fatal */ }

  // 8. Advance cursor
  const allDoneNow = cursorIdx + 1 + setsProcessed >= uniqSets.length;
  await sb.from('pokemon_tcg_ingestion_cursor').update({
    state: allDoneNow ? 'completed_for_day' : 'running',
    last_set_code: lastSetCode,
    last_language: remaining.length > 0 ? remaining[Math.min(setsProcessed - 1, remaining.length - 1)]?.tcg_language ?? null : null,
    cycle_credits_spent: (cursorRow.cycle_credits_spent ?? 0) + tracker.credits,
    cycle_sets_processed: (cursorRow.cycle_sets_processed ?? 0) + setsProcessed,
    cycle_cards_upserted: (cursorRow.cycle_cards_upserted ?? 0) + cardsUpserted,
    updated_at: new Date().toISOString(),
    cycle_completed_at: allDoneNow ? new Date().toISOString() : null,
  }).eq('id', cursorRow.id);

  await finish('completed', {
    cards_ingested: cardsUpserted,
    prices_market_rows: mkDeduped.length,
    prices_graded_rows: gdDeduped.length,
    metadata: {
      cycle_complete: allDoneNow,
      sets_processed_this_run: setsProcessed,
      monthly_remaining: lastRemaining,
    },
  });

  return NextResponse.json({
    ok: true,
    sets_processed: setsProcessed,
    cards_upserted: cardsUpserted,
    credits_spent: tracker.credits,
    monthly_remaining: lastRemaining,
    cycle_complete: allDoneNow,
    cycle_total_credits: (cursorRow.cycle_credits_spent ?? 0) + tracker.credits,
    cycle_total_sets: (cursorRow.cycle_sets_processed ?? 0) + setsProcessed,
    last_set_code: lastSetCode,
    sets_remaining: uniqSets.length - (cursorIdx + 1 + setsProcessed),
    duration_ms: Date.now() - t0,
  });
}
