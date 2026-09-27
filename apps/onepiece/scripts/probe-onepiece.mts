#!/usr/bin/env node
// Phase A probe: what's actually in production for One Piece.
//
// READ-ONLY. Uses the anon key only. No schema writes, no mutations,
// no service-role required. Mirrors the YGO audit-blue-eyes.mts /
// probe-daily-tables.mts pattern.
//
// Run: pnpm --filter @collector-network/onepiece probe:onepiece
// Requires apps/onepiece/.env.local with SUPABASE_URL + SUPABASE_ANON_KEY.
//
// Writes a plain-text report to stdout. Pipe to
// docs/onepiece/data-audit.md — the transcript is intended to become
// (with minor prose framing) the actual audit document.

// Import the shared client directly by its .ts source. The package's
// exports field points to .ts sources, but Node's ESM resolver + tsx
// don't pick that up for workspace-package imports; a direct file path
// bypasses that. Avoids server-only, which throws when loaded outside
// an RSC context.
const { createTcgClient } = await import(
  '../../../packages/database/src/client.ts'
);

// Production tcg_games row for OP has slug='one-piece' (hyphenated) and
// id='onepiece'. Verified 2026-09-26 via apps/onepiece/scripts/probe-games.mts.
// The YGO data-audit.md dated 2026-09-22 recorded the older slug='onepiece';
// the row was renamed later that day.
const GAME_SLUG = 'one-piece';

// Column projection is important — the shared row types include jsonb
// blobs (gamedata, images, tcggraph_meta) that we don't want in the
// stdout dump beyond a sample.

interface Row {
  [k: string]: unknown;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function hr(title: string): void {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(title);
  console.log('═'.repeat(72));
}

function sub(title: string): void {
  console.log(`\n─── ${title} ───`);
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

async function countRows(
  supabase: ReturnType<typeof createTcgClient>,
  table: string,
  gameFilter: { column: string; value: string } | null,
): Promise<number> {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (gameFilter) query = query.eq(gameFilter.column, gameFilter.value);
  const { count, error } = await query;
  if (error) {
    console.error(`  ! ${table} count failed: ${error.message}`);
    return -1;
  }
  return count ?? 0;
}

// PostgREST-style paginated fetch. `select` narrows columns so we don't
// pull jsonb blobs on huge sweeps.
async function fetchAll(
  supabase: ReturnType<typeof createTcgClient>,
  table: string,
  select: string,
  filters: Array<{ column: string; value: string }>,
  pageSize = 1000,
  hardCap = 200_000,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < hardCap; from += pageSize) {
    const to = from + pageSize - 1;
    let query = supabase.from(table).select(select).range(from, to);
    for (const f of filters) query = query.eq(f.column, f.value);
    const { data, error } = await query;
    if (error) throw new Error(`${table} page ${from}: ${error.message}`);
    const rows = (data as Row[] | null) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function distinctValues<T>(rows: Row[], key: string, get: (r: Row) => T): Map<T, number> {
  const m = new Map<T, number>();
  for (const r of rows) {
    const v = get(r);
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

function printDistribution<T>(m: Map<T, number>, opts: { label: string; sort?: 'count' | 'key' } = { label: 'value' }): void {
  const entries = [...m.entries()];
  if (opts.sort === 'key') {
    entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  } else {
    entries.sort((a, b) => b[1] - a[1]);
  }
  const width = Math.max(...entries.map((e) => String(e[0] ?? 'NULL').length), 10);
  for (const [k, n] of entries) {
    const label = String(k ?? 'NULL').padEnd(width);
    console.log(`    ${label}  ${fmt(n).padStart(8)}`);
  }
  console.log(`    ${'—'.repeat(width)}  ${'—'.repeat(8)}`);
  console.log(
    `    ${'total'.padEnd(width)}  ${fmt(entries.reduce((s, [, n]) => s + n, 0)).padStart(8)}`,
  );
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env['SUPABASE_URL'] || !process.env['SUPABASE_ANON_KEY']) {
    console.error(
      'FAIL: apps/onepiece/.env.local must set SUPABASE_URL + SUPABASE_ANON_KEY (anon key only)',
    );
    process.exit(1);
  }

  const supabase = createTcgClient();

  // ─── 0. Game row ─────────────────────────────────────────────────────
  hr('0 · tcg_games row for One Piece');
  const { data: gameRow, error: gameErr } = await supabase
    .from('tcg_games')
    .select('id, slug, name, active, created_at')
    .eq('slug', GAME_SLUG)
    .maybeSingle();
  if (gameErr) {
    console.error(`FAIL: tcg_games lookup: ${gameErr.message}`);
    process.exit(1);
  }
  if (!gameRow) {
    console.error(`FAIL: no tcg_games row with slug='${GAME_SLUG}'`);
    process.exit(1);
  }
  const game = gameRow as { id: string; slug: string; name: string; active: boolean; created_at: string };
  console.log(`  id:       ${game.id}`);
  console.log(`  slug:     ${game.slug}`);
  console.log(`  name:     ${game.name}`);
  console.log(`  active:   ${game.active}`);
  console.log(`  created:  ${game.created_at}`);

  const GAME_ID = game.id;
  const gf = { column: 'game_id', value: GAME_ID };

  // ─── 1. Row counts ────────────────────────────────────────────────────
  hr('1 · Row counts');
  const [setsN, cardsN, printingsN, retailN, gradedN, retailDailyN, gradedDailyN] =
    await Promise.all([
      countRows(supabase, 'tcg_sets', gf),
      countRows(supabase, 'tcg_cards', gf),
      countRows(supabase, 'tcg_printings', gf),
      countRows(supabase, 'tcg_market_prices_current', gf),
      countRows(supabase, 'tcg_graded_prices_current', gf),
      countRows(supabase, 'tcg_market_price_daily', gf),
      countRows(supabase, 'tcg_graded_price_daily', gf),
    ]);
  console.log(`  tcg_sets                    ${fmt(setsN).padStart(10)}`);
  console.log(`  tcg_cards                   ${fmt(cardsN).padStart(10)}`);
  console.log(`  tcg_printings               ${fmt(printingsN).padStart(10)}`);
  console.log(`  tcg_market_prices_current   ${fmt(retailN).padStart(10)}`);
  console.log(`  tcg_graded_prices_current   ${fmt(gradedN).padStart(10)}`);
  console.log(`  tcg_market_price_daily      ${fmt(retailDailyN).padStart(10)}`);
  console.log(`  tcg_graded_price_daily      ${fmt(gradedDailyN).padStart(10)}`);

  if (cardsN === 0) {
    console.log('\nOne Piece has no cards yet. Halting probe here.');
    return;
  }

  // ─── 2. Distinct rarities on tcg_cards ────────────────────────────────
  hr('2 · Distinct rarities (tcg_cards.rarity)');
  const cardMeta = await fetchAll(
    supabase,
    'tcg_cards',
    'id, name, language, rarity, artist, set_id, collector_number, tcggraph_card_id, english_id',
    [gf],
  );
  console.log(`  fetched ${fmt(cardMeta.length)} rows`);
  printDistribution(
    distinctValues(cardMeta, 'rarity', (r) => (r['rarity'] as string | null) ?? null),
    { label: 'rarity', sort: 'count' },
  );

  // ─── 3. Distinct languages ────────────────────────────────────────────
  sub('Distinct languages (tcg_cards.language)');
  printDistribution(
    distinctValues(cardMeta, 'language', (r) => (r['language'] as string | null) ?? null),
    { label: 'language', sort: 'count' },
  );

  // ─── 4. Sets summary ──────────────────────────────────────────────────
  hr('4 · Sets');
  const setRows = await fetchAll(
    supabase,
    'tcg_sets',
    'id, code, name, released_at, updated_at',
    [gf],
  );
  console.log(`  ${fmt(setRows.length)} sets`);
  const sortedSets = [...setRows].sort((a, b) => {
    const ad = a['released_at'] ? Date.parse(a['released_at'] as string) : 0;
    const bd = b['released_at'] ? Date.parse(b['released_at'] as string) : 0;
    return bd - ad;
  });
  const showN = Math.min(15, sortedSets.length);
  sub(`Newest ${showN} sets`);
  for (const s of sortedSets.slice(0, showN)) {
    const code = String(s['code'] ?? '?').padEnd(10);
    const name = String(s['name'] ?? '?').padEnd(48);
    console.log(`    ${code}  ${name}  released=${s['released_at'] ?? '?'}`);
  }

  // ─── 5. Distinct editions + finishes on tcg_printings ─────────────────
  hr('5 · Distinct editions, finishes, languages on tcg_printings');
  const printingMeta = await fetchAll(
    supabase,
    'tcg_printings',
    'id, tcg_card_id, set_id, tcggraph_printing_key, finish, edition, language, collector_number, cardmarket_id, tcgplayer_id, mapping_confidence',
    [gf],
  );
  console.log(`  fetched ${fmt(printingMeta.length)} printings`);

  sub('edition');
  printDistribution(
    distinctValues(printingMeta, 'edition', (r) => (r['edition'] as string | null) ?? null),
    { label: 'edition', sort: 'count' },
  );

  sub('finish');
  printDistribution(
    distinctValues(printingMeta, 'finish', (r) => (r['finish'] as string | null) ?? null),
    { label: 'finish', sort: 'count' },
  );

  sub('language');
  printDistribution(
    distinctValues(printingMeta, 'language', (r) => (r['language'] as string | null) ?? null),
    { label: 'language', sort: 'count' },
  );

  sub('tcggraph_printing_key');
  printDistribution(
    distinctValues(printingMeta, 'tcggraph_printing_key', (r) => (r['tcggraph_printing_key'] as string | null) ?? null),
    { label: 'key', sort: 'count' },
  );

  sub('cardmarket_id present?');
  const cmYes = printingMeta.filter((r) => r['cardmarket_id'] != null).length;
  console.log(`    populated: ${fmt(cmYes)}`);
  console.log(`    null:      ${fmt(printingMeta.length - cmYes)}`);

  sub('tcgplayer_id present?');
  const tpYes = printingMeta.filter((r) => r['tcgplayer_id'] != null).length;
  console.log(`    populated: ${fmt(tpYes)}`);
  console.log(`    null:      ${fmt(printingMeta.length - tpYes)}`);

  // ─── 6. Retail price sources + currencies ─────────────────────────────
  hr('6 · Retail price sources + currencies');
  const retailRows =
    retailN <= 0
      ? []
      : await fetchAll(
          supabase,
          'tcg_market_prices_current',
          'tcg_printing_id, source, list_type, region, currency, finish, price, price_low, avg_7d, avg_30d, updated_at',
          [gf],
        );
  console.log(`  fetched ${fmt(retailRows.length)} retail rows`);

  sub('source');
  printDistribution(
    distinctValues(retailRows, 'source', (r) => (r['source'] as string | null) ?? null),
    { label: 'source', sort: 'count' },
  );

  sub('currency');
  printDistribution(
    distinctValues(retailRows, 'currency', (r) => (r['currency'] as string | null) ?? null),
    { label: 'currency', sort: 'count' },
  );

  sub('list_type');
  printDistribution(
    distinctValues(retailRows, 'list_type', (r) => (r['list_type'] as string | null) ?? null),
    { label: 'list_type', sort: 'count' },
  );

  sub('region');
  printDistribution(
    distinctValues(retailRows, 'region', (r) => (r['region'] as string | null) ?? null),
    { label: 'region', sort: 'count' },
  );

  const retailUpdatedAts = retailRows
    .map((r) => (r['updated_at'] as string | null) ?? '')
    .filter(Boolean)
    .sort();
  if (retailUpdatedAts.length > 0) {
    sub('updated_at range');
    console.log(`    oldest:  ${retailUpdatedAts[0]}`);
    console.log(`    newest:  ${retailUpdatedAts[retailUpdatedAts.length - 1]}`);
  }

  // ─── 7. Graded distribution ───────────────────────────────────────────
  hr('7 · Graded pricing');
  const gradedRows =
    gradedN <= 0
      ? []
      : await fetchAll(
          supabase,
          'tcg_graded_prices_current',
          'tcg_printing_id, tcg_card_id, grader, grade, currency, price, card_sales_volume, attribution, updated_at',
          [gf],
        );
  console.log(`  fetched ${fmt(gradedRows.length)} graded rows`);

  sub('grader');
  printDistribution(
    distinctValues(gradedRows, 'grader', (r) => (r['grader'] as string | null) ?? null),
    { label: 'grader', sort: 'count' },
  );

  sub('grade');
  printDistribution(
    distinctValues(gradedRows, 'grade', (r) => (r['grade'] as string | null) ?? null),
    { label: 'grade', sort: 'key' },
  );

  sub('attribution');
  printDistribution(
    distinctValues(gradedRows, 'attribution', (r) => (r['attribution'] as string | null) ?? null),
    { label: 'attribution', sort: 'count' },
  );

  sub('currency (graded)');
  printDistribution(
    distinctValues(gradedRows, 'currency', (r) => (r['currency'] as string | null) ?? null),
    { label: 'currency', sort: 'count' },
  );

  // ─── 8. Treatment vocabulary inspection ───────────────────────────────
  //
  // The user cares specifically about whether these treatments are
  // stored as distinct collectible identities:
  //   standard | parallel | alternate art | manga rare | special rare
  //   | promo | English / Japanese
  //
  // The generic tcg_* schema exposes rarity + edition + finish + language
  // as the treatment axes. We probe for signatures of each treatment
  // by regex-matching those fields.

  hr('8 · Treatment vocabulary — signatures across rarity / edition / finish');

  const patterns: Array<{ label: string; needle: RegExp }> = [
    { label: 'standard / base',   needle: /^(standard|base|common|c|r|sr|leader|l)$/i },
    { label: 'parallel',          needle: /parallel/i },
    { label: 'alternate art',     needle: /(alternate\s*art|alt\.?\s*art|\baa\b)/i },
    { label: 'manga rare',        needle: /manga/i },
    { label: 'special rare',      needle: /special\s*rare|\bsp\b/i },
    { label: 'secret rare',       needle: /secret\s*rare|\bsec\b/i },
    { label: 'promo',             needle: /promo/i },
    { label: 'treasure rare',     needle: /treasure|\btr\b/i },
    { label: 'super rare',        needle: /super\s*rare/i },
  ];

  const rarityValues = new Set(cardMeta.map((r) => (r['rarity'] as string | null) ?? ''));
  const editionValues = new Set(printingMeta.map((r) => (r['edition'] as string | null) ?? ''));
  const finishValues = new Set(printingMeta.map((r) => (r['finish'] as string | null) ?? ''));

  sub('rarity strings that carry treatment signal');
  for (const p of patterns) {
    const hits = [...rarityValues].filter((v) => v && p.needle.test(v));
    if (hits.length > 0) {
      console.log(`    ${p.label.padEnd(18)}  → rarity: ${hits.join(', ')}`);
    }
  }
  sub('edition strings that carry treatment signal');
  for (const p of patterns) {
    const hits = [...editionValues].filter((v) => v && p.needle.test(v));
    if (hits.length > 0) {
      console.log(`    ${p.label.padEnd(18)}  → edition: ${hits.join(', ')}`);
    }
  }
  sub('finish strings that carry treatment signal');
  for (const p of patterns) {
    const hits = [...finishValues].filter((v) => v && p.needle.test(v));
    if (hits.length > 0) {
      console.log(`    ${p.label.padEnd(18)}  → finish: ${hits.join(', ')}`);
    }
  }

  sub('language coverage');
  console.log('    tcg_cards languages:     ' + [...new Set(cardMeta.map((r) => r['language']))].join(', '));
  console.log('    tcg_printings languages: ' + [...new Set(printingMeta.map((r) => r['language']))].join(', '));

  // ─── 9. Representative trace: name → cards → printings → prices ──────
  //
  // Try Monkey D. Luffy first (single most-printed name in OP), fall
  // back to the card with the most tcg_cards rows if Luffy is missing.
  hr('9 · Representative trace — logical card → cards → printings → prices');

  const cardsByName = new Map<string, Row[]>();
  for (const r of cardMeta) {
    const name = String(r['name']);
    const bucket = cardsByName.get(name);
    if (bucket) bucket.push(r);
    else cardsByName.set(name, [r]);
  }
  const traceCandidates = [
    'Monkey D. Luffy',
    'Monkey.D.Luffy',
    'Roronoa Zoro',
    'Roronoa.Zoro',
    'Kaido',
    'Charlotte Katakuri',
  ];
  let traceName: string | null = null;
  for (const n of traceCandidates) {
    if (cardsByName.has(n)) {
      traceName = n;
      break;
    }
  }
  if (!traceName) {
    // Pick whichever name has the most tcg_cards rows — that's the OP
    // equivalent of "many treatments across many sets".
    let best: [string, Row[]] | null = null;
    for (const entry of cardsByName) {
      if (!best || entry[1].length > best[1].length) best = entry;
    }
    if (best) traceName = best[0];
  }
  if (!traceName) {
    console.log('  no card names found — skipping trace');
    return;
  }

  const traceCards = cardsByName.get(traceName) ?? [];
  console.log(`  trace name: "${traceName}"`);
  console.log(`  tcg_cards rows: ${traceCards.length}`);

  const printingsByCard = new Map<string, Row[]>();
  for (const p of printingMeta) {
    const key = String(p['tcg_card_id']);
    const bucket = printingsByCard.get(key);
    if (bucket) bucket.push(p);
    else printingsByCard.set(key, [p]);
  }

  const printingIds = traceCards
    .flatMap((c) => printingsByCard.get(String(c['id'])) ?? [])
    .map((p) => String(p['id']));

  const retailByPrinting = new Map<string, Row[]>();
  for (const r of retailRows) {
    const key = String(r['tcg_printing_id']);
    const bucket = retailByPrinting.get(key);
    if (bucket) bucket.push(r);
    else retailByPrinting.set(key, [r]);
  }

  const gradedByPrinting = new Map<string, Row[]>();
  const gradedByCard = new Map<string, Row[]>();
  for (const r of gradedRows) {
    const printingKey = r['tcg_printing_id'];
    const cardKey = r['tcg_card_id'];
    if (typeof printingKey === 'string') {
      const bucket = gradedByPrinting.get(printingKey);
      if (bucket) bucket.push(r);
      else gradedByPrinting.set(printingKey, [r]);
    }
    if (typeof cardKey === 'string') {
      const bucket = gradedByCard.get(cardKey);
      if (bucket) bucket.push(r);
      else gradedByCard.set(cardKey, [r]);
    }
  }

  // set_id → set metadata lookup for display
  const setById = new Map<string, Row>();
  for (const s of setRows) setById.set(String(s['id']), s);

  console.log(`  total printings across these cards: ${printingIds.length}`);
  console.log(
    `  retail quotes:      ${printingIds.reduce((n, id) => n + (retailByPrinting.get(id)?.length ?? 0), 0)}`,
  );
  console.log(
    `  graded quotes (printing-scoped): ${printingIds.reduce((n, id) => n + (gradedByPrinting.get(id)?.length ?? 0), 0)}`,
  );
  console.log(
    `  graded quotes (card-scoped):     ${traceCards.reduce((n, c) => n + (gradedByCard.get(String(c['id']))?.length ?? 0), 0)}`,
  );

  // Show up to 10 cards for readability.
  const shownCards = traceCards.slice(0, 10);
  for (const card of shownCards) {
    const setId = String(card['set_id']);
    const set = setById.get(setId);
    const setLabel = set ? `${set['code']} ${set['name']}` : setId;
    console.log(
      `\n  ── card ${card['collector_number']} · rarity=${card['rarity'] ?? '(null)'} · lang=${card['language']} · ${setLabel}`,
    );
    console.log(`     card_id=${card['id']}`);
    const cardPrintings = printingsByCard.get(String(card['id'])) ?? [];
    for (const p of cardPrintings) {
      console.log(
        `     · printing edition=${p['edition'] ?? '(null)'} finish=${p['finish'] ?? '(null)'} lang=${p['language']} key=${p['tcggraph_printing_key'] ?? '(null)'}`,
      );
      const rq = retailByPrinting.get(String(p['id'])) ?? [];
      for (const r of rq) {
        console.log(
          `         retail ${r['source']} ${r['currency']} ${r['price'] ?? '-'} (low ${r['price_low'] ?? '-'}) list=${r['list_type'] ?? '-'} region=${r['region'] ?? '-'} @ ${String(r['updated_at']).slice(0, 10)}`,
        );
      }
      const pg = gradedByPrinting.get(String(p['id'])) ?? [];
      for (const g of pg) {
        console.log(
          `         graded[printing] ${g['grader']} ${g['grade']} ${g['currency']} ${g['price'] ?? '-'} attribution=${g['attribution']} vol=${g['card_sales_volume'] ?? '-'}`,
        );
      }
      if (rq.length === 0 && pg.length === 0) console.log('         (no pricing)');
    }
    const cg = gradedByCard.get(String(card['id'])) ?? [];
    for (const g of cg) {
      console.log(
        `     graded[card-scoped] ${g['grader']} ${g['grade']} ${g['currency']} ${g['price'] ?? '-'} vol=${g['card_sales_volume'] ?? '-'}`,
      );
    }
  }
  if (traceCards.length > shownCards.length) {
    console.log(`\n  ...(${traceCards.length - shownCards.length} more card rows not shown)`);
  }

  // ─── 10. gamedata sample ──────────────────────────────────────────────
  hr('10 · Sample tcg_cards.gamedata payloads');
  const { data: sample } = await supabase
    .from('tcg_cards')
    .select('id, name, collector_number, rarity, language, gamedata')
    .eq('game_id', GAME_ID)
    .limit(5);
  for (const r of (sample as Row[] | null) ?? []) {
    console.log(
      `\n  ${r['collector_number']}  ${r['name']}  ${r['rarity'] ?? ''}  ${r['language']}`,
    );
    console.log('  ' + JSON.stringify(r['gamedata']).slice(0, 400));
  }

  hr('DONE');
  console.log('No writes were performed. All queries used anon SELECT.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
