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

interface RequestTracker {
  /** Sum of `x-credits-cost` headers that TCGGraph actually billed. The
   *  provider sets this header on paid endpoints; some free endpoints
   *  omit it entirely. We no longer bill the default `1` to our tracker
   *  for a missing header — that was the source of a ~68% overcount vs
   *  the authoritative `x-credits-remaining` counter. */
  credits_billed: number;
  /** Count of requests where the header was present but zero (cache hits,
   *  prefetched routes). Pure telemetry. */
  requests_free: number;
  /** Count of requests where no x-credits-cost header was returned at all.
   *  These should correspond to free endpoints — tracked separately so we
   *  can detect regressions. */
  requests_unmetered: number;
  requests: number;
  /** Delta between the first and latest `x-credits-remaining` headers we
   *  saw within this run. This is the AUTHORITATIVE spend figure. */
  remaining_first: number | null;
  remaining_last: number | null;
}

async function fetchJson<T = unknown>(url: string, apiKey: string, tracker: RequestTracker): Promise<{ status: number; body: T | null; remaining: number | null }> {
  tracker.requests += 1;
  const r = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
  });
  const costHeader = r.headers.get('x-credits-cost');
  const remainingHeader = r.headers.get('x-credits-remaining');
  const cost = costHeader == null ? null : Number(costHeader);
  const remaining = remainingHeader == null ? null : Number(remainingHeader);
  if (cost == null || !Number.isFinite(cost)) {
    tracker.requests_unmetered += 1;
  } else if (cost === 0) {
    tracker.requests_free += 1;
  } else {
    tracker.credits_billed += cost;
  }
  if (remaining != null && Number.isFinite(remaining)) {
    if (tracker.remaining_first == null) tracker.remaining_first = remaining;
    tracker.remaining_last = remaining;
  }
  const body = (await r.json().catch(() => null)) as T | null;
  return { status: r.status, body, remaining: Number.isFinite(remaining as number) ? (remaining as number) : null };
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

interface ListCardsResult {
  cards: Card[];
  /** True only when pagination terminated naturally via hasMore=false
   *  (or an empty page). False means we hit the page-20 safety cap —
   *  the response is INCOMPLETE and the reclassification detector
   *  must not mark anything from this set this cycle. */
  complete: boolean;
}

async function listCardsInSet(setCode: string, language: string, apiKey: string, tracker: RequestTracker): Promise<ListCardsResult> {
  const all: Card[] = [];
  let page = 1;
  let complete = false;
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
    if (!r.body.meta?.hasMore || rows.length === 0) { complete = true; break; }
    page += 1;
    if (page > 20) break;  // INCOMPLETE — safety cap; `complete` stays false
  }
  return { cards: all, complete };
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
  const tracker: RequestTracker = {
    credits_billed: 0,
    requests_free: 0,
    requests_unmetered: 0,
    requests: 0,
    remaining_first: null,
    remaining_last: null,
  };
  // Authoritative spend = delta of the TCGGraph counter observed by this run.
  // Computed on finish; may be null if no priced calls were made.
  const observedSpend = () =>
    tracker.remaining_first != null && tracker.remaining_last != null
      ? tracker.remaining_first - tracker.remaining_last
      : null;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const catalogueVersion = `daily-${todayUtc}`;
  // MIGRATE-05: operator-triggered bounded test runs can pass
  // ?max_sets=N to cap the number of sets processed in this
  // invocation (default is SET_BATCH=25).
  const url = new URL(req.url);
  const maxSetsOverride = Number(url.searchParams.get('max_sets'));
  const effectiveSetBatch = Number.isFinite(maxSetsOverride) && maxSetsOverride > 0
    ? Math.min(maxSetsOverride, SET_BATCH)
    : SET_BATCH;

  // 1. Load (and advance if needed) the cursor
  const { data: cursorRow, error: cErr } = await sb
    .from('pokemon_tcg_ingestion_cursor')
    .select('*')
    .eq('provider', 'tcggraph')
    .eq('kind', 'daily_catalogue')
    .maybeSingle();
  if (cErr) return NextResponse.json({ ok: false, error: `cursor read: ${cErr.message}` }, { status: 500 });
  if (!cursorRow) return NextResponse.json({ ok: false, error: 'cursor row missing — rerun migration' }, { status: 500 });

  // MIGRATE-05 / APPROVAL-02: cycle_date is the day a cycle STARTED.
  // Day-boundary semantics:
  //   • completed_for_day + sameDay → short-circuit (done today)
  //   • completed_for_day + !sameDay → start a fresh cycle (new day)
  //   • idle / failed → start a fresh cycle
  //   • running + sameDay → continue the current cycle
  //   • running + !sameDay → CONTINUE the current cycle. A partially-
  //     done cycle crossing midnight must NOT wipe last_set_code. If
  //     a run has been stuck in `running` for more than 36h, we treat
  //     it as stale and reset — that's the operational safety net
  //     against a cycle that genuinely wedged.
  const cursorDay = (cursorRow as any).cycle_date
    ?? (cursorRow.cycle_started_at ? String(cursorRow.cycle_started_at).slice(0, 10) : null);
  const sameDay = cursorDay === todayUtc;
  const alreadyDone = cursorRow.state === 'completed_for_day' && sameDay;
  if (alreadyDone) {
    return NextResponse.json({
      ok: true,
      skipped: 'completed_for_day',
      cycle_date: cursorDay,
      last_set_code: cursorRow.last_set_code,
      cycle_credits: cursorRow.cycle_credits_spent,
    });
  }

  const STALE_RUN_MS = 36 * 60 * 60 * 1000;
  const cycleStartedAt = cursorRow.cycle_started_at ? new Date(cursorRow.cycle_started_at).getTime() : 0;
  const cycleStale = cursorRow.state === 'running' && cycleStartedAt > 0 && (Date.now() - cycleStartedAt) > STALE_RUN_MS;

  const freshCycleNeeded =
    cursorRow.state === 'idle' ||
    cursorRow.state === 'failed' ||
    (cursorRow.state === 'completed_for_day' && !sameDay) ||
    cycleStale;

  if (freshCycleNeeded) {
    await sb.from('pokemon_tcg_ingestion_cursor').update({
      state: 'running',
      cycle_date: todayUtc,
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
    // state === 'running': continue regardless of UTC day boundary.
    // Preserve last_set_code so the cycle resumes where it left off.
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
      credits_spent: observedSpend() ?? tracker.credits_billed, requests_made: tracker.requests, ...extra,
    }).eq('id', run.id);
  };

  // 4. Get the ordered list of sets we still need to process this cycle
  //
  // JA-INGEST-FIX: TCGGraph publishes some set codes (e.g. xy6, sv3,
  // sm9) in BOTH English and Japanese catalogues with the same code
  // and different `tcg_set_name`. The dedup key must be the composite
  // (code, language) so each catalogue is refreshed independently.
  // Deduping by set_code alone drops ~20 JA catalogues per cycle and
  // leaves ~3,130 JA cards stale (observed 2026-10-19).
  const { data: observed } = await sb.from('pokemon_tcg_sets_observed')
    .select('tcg_set_code, tcg_set_name, tcg_language')
    .order('observed_at', { ascending: false });
  if (!observed || observed.length === 0) {
    await finish('failed', { error_message: 'no sets observed yet; run discovery first' });
    return NextResponse.json({ ok: false, error: 'no sets observed; run /api/cron/pp-tcg-discover first' }, { status: 500 });
  }
  // Unique (set_code, language) pairs, EN first then JA, each alphabetical.
  const uniqSets: SetRow[] = [];
  const seenPair = new Set<string>();
  for (const s of observed as SetRow[]) {
    const key = `${s.tcg_set_code}|${s.tcg_language}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    uniqSets.push({ tcg_set_code: s.tcg_set_code, tcg_set_name: s.tcg_set_name, tcg_language: s.tcg_language });
  }
  uniqSets.sort((a, b) => {
    if (a.tcg_language !== b.tcg_language) return a.tcg_language === 'en' ? -1 : 1;
    return a.tcg_set_code.localeCompare(b.tcg_set_code);
  });

  // Skip to just-after the cursor. Composite key (code, language) so a
  // JA-only cycle resumes correctly after processing all EN variants.
  const cursorIdx = cursorRow.last_set_code
    ? uniqSets.findIndex(s => s.tcg_set_code === cursorRow.last_set_code && s.tcg_language === (cursorRow.last_language ?? s.tcg_language))
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
  let lastLanguage = cursorRow.last_language as string | null;
  let lastRemaining: number | null = null;
  const providerCards: Array<Record<string, unknown>> = [];
  const marketRows: Array<Record<string, unknown>> = [];
  const gradedRows: Array<Record<string, unknown>> = [];
  // PP-TCG-PRINTING-RECLASS-CLOSEOUT §2 — per-set reclassification
  // input, captured ONLY when pagination completed naturally.
  const reclassWorkPerSet: Array<{
    setCode: string;
    language: string;
    apiCards: Array<{ id: string; printing_keys: string[] }>;
  }> = [];

  for (const s of remaining) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;
    if (setsProcessed >= effectiveSetBatch) break;
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
      const listed = await listCardsInSet(s.tcg_set_code, s.tcg_language, apiKey, tracker);
      const cards = listed.cards;
      for (const c of cards) {
        const { providerCardRows, marketRows: mr, gradedRows: gr } = cardToProviderRows(c, catalogueVersion);
        providerCards.push(...providerCardRows);
        marketRows.push(...mr);
        gradedRows.push(...gr);
      }
      // Printing-reclassification detection — only run when pagination
      // was COMPLETE for this set. Safe-fail: if listed.complete is
      // false (we hit the page-20 cap or any error path), we have an
      // incomplete picture and must NOT mark anything.
      if (listed.complete && cards.length > 0) {
        reclassWorkPerSet.push({
          setCode: s.tcg_set_code,
          language: s.tcg_language,
          apiCards: cards.map(c => ({
            id: c.id,
            printing_keys: c.printings?.length
              ? [...new Set(c.printings.map(p => p.key || 'normal'))]
              : ['normal'],
          })),
        });
      }
      cardsUpserted += cards.length;
      setsProcessed += 1;
      lastSetCode = s.tcg_set_code;
      lastLanguage = s.tcg_language;
      // Read the latest `remaining` from the last response — we tracked it via the fetchJson wrapper.
      // Simpler: ping /v1/games/pokemon once at the end to get the latest number.
    } catch (err) {
      await finish('failed', { error_message: `set ${s.tcg_set_code}: ${(err as Error).message}` });
      await sb.from('pokemon_tcg_ingestion_cursor').update({
        state: 'failed', updated_at: new Date().toISOString(),
      }).eq('id', cursorRow.id);
      return NextResponse.json({
        ok: false, error: `set ${s.tcg_set_code}: ${(err as Error).message}`,
        sets_processed: setsProcessed, credits_spent: observedSpend() ?? tracker.credits_billed,
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

  // 6.5 Printing-reclassification detection — zero additional API calls.
  //
  // For each (set, language) whose listCardsInSet pagination terminated
  // naturally (listed.complete=true), compare the API's returned
  // (card_id, printing_key) pairs to the currently-active stored rows.
  // Rows whose (card_id) IS in the API response but whose printing_key
  // is NOT — strong evidence of a provider reclassification. Mark those
  // rows provider_status='superseded'. No deletion. No touch to
  // prices_market, prices_graded, or prices_history. Rows for card_ids
  // ABSENT from the API response are LEFT ACTIVE — could be a
  // transiently absent card OR a genuine removal, operator decides.
  //
  // Safe-by-default: if listed.complete was false (page-20 cap hit),
  // this set's entry is not in reclassWorkPerSet and nothing is
  // marked for it this cycle.
  let reclassMarked = 0;
  if (reclassWorkPerSet.length > 0) {
    for (const w of reclassWorkPerSet) {
      // Build card_id → set of printing_keys from the complete API response.
      const apiPrintings = new Map<string, Set<string>>();
      for (const c of w.apiCards) apiPrintings.set(c.id, new Set(c.printing_keys));
      // Pull stored active rows for this (set, lang).
      const { data: storedActive } = await sb.from('pokemon_tcg_provider_cards')
        .select('id, tcg_card_id, tcg_printing_key')
        .eq('provider', 'tcggraph')
        .eq('tcg_set_code', w.setCode)
        .eq('tcg_language', w.language)
        .eq('provider_status', 'active');
      const orphans: Array<{ id: string; supersededByKey: string }> = [];
      for (const sRow of (storedActive ?? [])) {
        const apiKeys = apiPrintings.get(sRow.tcg_card_id);
        if (!apiKeys) continue;                              // card_id absent → leave active
        if (apiKeys.has(sRow.tcg_printing_key)) continue;    // printing still exists → active
        // Same card_id, different printing_key → reclassified
        orphans.push({ id: sRow.id, supersededByKey: [...apiKeys][0] ?? 'unknown' });
      }
      for (const o of orphans) {
        await sb.from('pokemon_tcg_provider_cards').update({
          provider_status: 'superseded',
          superseded_at: new Date().toISOString(),
          superseded_reason: `chunk cron: tcggraph reclassified printing_key for ${w.setCode}|${w.language}`,
          superseded_by_printing_key: o.supersededByKey,
        }).eq('id', o.id).eq('provider_status', 'active');   // optimistic — never double-mark
        reclassMarked += 1;
      }
    }
    // PP-TCG-MATCH-FINAL §7 — flag approved mappings that now reference
    // a superseded (card_id, printing_key). Writes a warning into the
    // existing pokemon_tcg_mapping_qa.warnings array so the admin
    // workbench surfaces the affected mappings without a new dashboard.
    // Only acts on approved mappings — pending ones already see this
    // state in the normal risk_class flow.
    try {
      const supersededPairs = new Set<string>();
      for (const w of reclassWorkPerSet) {
        const apiPrintings = new Map<string, Set<string>>();
        for (const c of w.apiCards) apiPrintings.set(c.id, new Set(c.printing_keys));
        // Query the rows we just marked for this set
        const { data: supInThisSet } = await sb.from('pokemon_tcg_provider_cards')
          .select('tcg_card_id, tcg_printing_key')
          .eq('provider', 'tcggraph')
          .eq('tcg_set_code', w.setCode)
          .eq('tcg_language', w.language)
          .eq('provider_status', 'superseded');
        for (const r of (supInThisSet ?? [])) supersededPairs.add(`${r.tcg_card_id}|${r.tcg_printing_key}`);
      }
      if (supersededPairs.size > 0) {
        // Find approved mappings pointing at any of those pairs
        const cardIds = [...new Set([...supersededPairs].map(k => k.split('|')[0]))];
        const affectedMappings: Array<{ id: string; tcg_card_id: string; tcg_printing_key: string }> = [];
        for (let i = 0; i < cardIds.length; i += 100) {
          const { data: ms } = await sb.from('pokemon_tcg_mappings')
            .select('id,tcg_card_id,tcg_printing_key')
            .eq('provider', 'tcggraph')
            .eq('review_status', 'approved')
            .in('tcg_card_id', cardIds.slice(i, i + 100));
          for (const m of (ms ?? [])) {
            if (m.tcg_card_id && m.tcg_printing_key && supersededPairs.has(`${m.tcg_card_id}|${m.tcg_printing_key}`)) {
              affectedMappings.push({ id: m.id, tcg_card_id: m.tcg_card_id, tcg_printing_key: m.tcg_printing_key });
            }
          }
        }
        for (const am of affectedMappings) {
          const warning = `approved mapping now points at superseded (${am.tcg_card_id}, ${am.tcg_printing_key}) — public adapter fails closed; operator review required`;
          // Fetch existing warnings to append (never overwrite).
          const { data: existingQa } = await sb.from('pokemon_tcg_mapping_qa')
            .select('warnings').eq('mapping_id', am.id).maybeSingle();
          const existing: string[] = Array.isArray(existingQa?.warnings) ? existingQa.warnings : [];
          if (existing.some(w => typeof w === 'string' && w.includes('superseded'))) continue;    // already flagged
          const merged = [...existing, warning];
          await sb.from('pokemon_tcg_mapping_qa').update({ warnings: merged }).eq('mapping_id', am.id);
        }
      }
    } catch (e) {
      // Non-fatal — operator can still see provider_status directly.
      console.error('reclass-flag approved mappings:', e);
    }
  }

  // 7. Peek current credits for monitoring
  try {
    const u = new URL('https://api.tcggraph.com/v1/games/pokemon');
    const r = await fetchJson<{}>(u.toString(), apiKey, tracker);
    lastRemaining = r.remaining;
  } catch { /* non-fatal */ }

  // 8. Advance cursor. allDoneNow uses uniqSets.length which now counts
  // (code, language) PAIRS, so JA-only variants count toward completion.
  const allDoneNow = cursorIdx + 1 + setsProcessed >= uniqSets.length;
  await sb.from('pokemon_tcg_ingestion_cursor').update({
    state: allDoneNow ? 'completed_for_day' : 'running',
    last_set_code: lastSetCode,
    last_language: lastLanguage,
    cycle_credits_spent: (cursorRow.cycle_credits_spent ?? 0) + (observedSpend() ?? tracker.credits_billed),
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
      reclass_marked_superseded: reclassMarked,
      reclass_sets_scanned: reclassWorkPerSet.length,
    },
  });

  const authoritativeSpend = observedSpend();
  return NextResponse.json({
    ok: true,
    sets_processed: setsProcessed,
    cards_upserted: cardsUpserted,
    // Authoritative: delta of x-credits-remaining observed by this run.
    credits_spent: authoritativeSpend ?? tracker.credits_billed,
    // Diagnostic: all three locally-computed counters for transparency.
    reclass_marked_superseded: reclassMarked,
    reclass_sets_scanned: reclassWorkPerSet.length,
    credits_telemetry: {
      authoritative_observed_delta: authoritativeSpend,
      billed_from_cost_headers: tracker.credits_billed,
      requests_total: tracker.requests,
      requests_free: tracker.requests_free,
      requests_unmetered: tracker.requests_unmetered,
    },
    monthly_remaining: lastRemaining,
    cycle_complete: allDoneNow,
    cycle_total_credits: (cursorRow.cycle_credits_spent ?? 0) + (authoritativeSpend ?? tracker.credits_billed),
    cycle_total_sets: (cursorRow.cycle_sets_processed ?? 0) + setsProcessed,
    last_set_code: lastSetCode,
    sets_remaining: uniqSets.length - (cursorIdx + 1 + setsProcessed),
    duration_ms: Date.now() - t0,
  });
}
