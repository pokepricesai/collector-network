import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// CN-06.06 corrections pass 3 · unified-migration regression test.
//
// Reproduces the production bug (2026-11-06):
//
//   ERROR: 23505: duplicate key value violates unique constraint
//          "network_tcg_releases_unique_key"
//   DETAIL: Key (tcg, COALESCE(set_code, ''::text), language,
//           COALESCE(region, ''::text)) = (pokemon, , en, US)
//           already exists.
//
// Root cause: the unique index coalesced NULL set_code to '',
// which collapsed all three Pokémon releases (Delta Reign, 30th
// Celebration, Pitch Black — all with set_code NULL and region
// 'US') into one slot.
//
// This test applies the full repaired unified script to a fresh
// PGlite and asserts:
//   1. Every migration runs clean — no 23505, no CHECK violation.
//   2. All 22 seed rows insert.
//   3. The breakdown by TCG matches the expected counts.
//   4. A second run inserts 0 duplicates (idempotent).
//   5. The new unique index semantics distinguish name-only rows.
//   6. Legitimate region-paired rows (YGO MAMS EU vs NA) coexist.

const SQL_FILES = [
  '20261029000000_tcg_releases.sql',           // pre-existing on prod
  '20261107000000_releases_public_view.sql',   // deploy step 1
  '20261107010000_releases_review_gate.sql',   // deploy step 2
  '20261107030000_releases_quarter_and_region.sql', // deploy step 3
  '20261107020000_releases_initial_seed.sql',  // deploy step 4
]

const SQL = SQL_FILES.map((f) =>
  readFileSync(
    join(process.cwd(), '..', '..', 'supabase', 'migrations', f),
    'utf8',
  ),
)

// Stub Supabase roles + the admin table / function referenced by
// the base migration's RLS policies. Minimal enough to let the
// GRANT and REFERENCES lines compile without changing behaviour.
const STUB_SQL = `
do $pgl$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $pgl$;

create table if not exists public.network_admin_users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function public.network_is_admin()
returns boolean language sql stable as $fn$ select false $fn$;
`

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUB_SQL)
  for (const chunk of SQL) {
    await db.exec(chunk)
  }
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe('unified migration · fresh apply', () => {
  it('inserts exactly 22 seed rows across 5 TCGs with correct per-TCG counts', async () => {
    const r = await db.query<{ tcg: string; n: number }>(
      `select tcg, count(*)::int as n
         from public.network_tcg_releases
         group by tcg
         order by tcg`,
    )
    expect(r.rows).toEqual([
      { tcg: 'lorcana',  n: 3 },
      { tcg: 'mtg',      n: 5 },
      { tcg: 'onepiece', n: 5 },
      { tcg: 'pokemon',  n: 3 },
      { tcg: 'ygo',      n: 6 },
    ])
  })

  it('all 22 rows are review_status=approved (seed policy)', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n
         from public.network_tcg_releases
         where review_status = 'approved'`,
    )
    expect(r.rows[0]!.n).toBe(22)
  })

  it('zero pending_review + rejected rows (none seeded)', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n
         from public.network_tcg_releases
         where review_status in ('pending_review', 'rejected')`,
    )
    expect(r.rows[0]!.n).toBe(0)
  })

  it('public view returns 22 rows (all seed rows are primary + public-safe)', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases_public`,
    )
    expect(r.rows[0]!.n).toBe(22)
  })
})

describe('unified migration · regression on the 2026-11-06 bug', () => {
  it('Pokémon releases with NULL set_code + same region coexist', async () => {
    // These three rows all produced (pokemon, '', en, US) under the
    // broken unique index. Under the effective-identifier index
    // they produce three distinct keys.
    const r = await db.query<{ set_name: string }>(
      `select set_name
         from public.network_tcg_releases
         where tcg = 'pokemon'
         order by set_name`,
    )
    expect(r.rows.map((x) => x.set_name)).toEqual([
      'Pokémon TCG: 30th Celebration',
      'Pokémon TCG: Mega Evolution—Delta Reign',
      'Pokémon TCG: Mega Evolution—Pitch Black',
    ])
  })

  it('Lorcana releases with NULL set_code + NULL region coexist', async () => {
    const r = await db.query<{ set_name: string }>(
      `select set_name
         from public.network_tcg_releases
         where tcg = 'lorcana'
         order by set_name`,
    )
    expect(r.rows.map((x) => x.set_name)).toEqual([
      'Cosmic Quest',
      'Hyperia City',
      'Into the Inkdark',
    ])
  })

  it('YGO regional pair (MAMS EU + NA) coexists under the new key', async () => {
    const r = await db.query<{ region: string; release_date: string }>(
      `select region, release_date::text as release_date
         from public.network_tcg_releases
         where tcg = 'ygo' and set_code = 'MAMS'
         order by region`,
    )
    expect(r.rows).toEqual([
      { region: 'EU', release_date: '2026-11-12' },
      { region: 'NA', release_date: '2026-11-13' },
    ])
  })

  it('MTG NULL-set_code row (Reality Fracture) coexists with coded rows', async () => {
    const r = await db.query<{ set_name: string; set_code: string | null }>(
      `select set_name, set_code
         from public.network_tcg_releases
         where tcg = 'mtg'
         order by set_name`,
    )
    // 5 rows, mix of coded (TRK, NAU, MDD) and null-coded (Kamigawa,
    // Reality Fracture). All five must be present.
    expect(r.rows).toHaveLength(5)
  })
})

describe('unified migration · idempotency on second run', () => {
  it('re-applying the unified script inserts 0 duplicates', async () => {
    // Re-run only the seed (which is the only INSERT migration).
    // Schema migrations are already idempotent by design and
    // asserted by their individual tests.
    const beforeCounts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases`,
    )
    const beforeN = beforeCounts.rows[0]!.n

    const SEED_SQL = readFileSync(
      join(process.cwd(), '..', '..', 'supabase', 'migrations',
           '20261107020000_releases_initial_seed.sql'),
      'utf8',
    )
    await db.exec(SEED_SQL)

    const afterCounts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases`,
    )
    expect(afterCounts.rows[0]!.n).toBe(beforeN)
  })

  it('re-applying the full migration-030 (unique-index swap) is idempotent', async () => {
    const SQL_030 = readFileSync(
      join(process.cwd(), '..', '..', 'supabase', 'migrations',
           '20261107030000_releases_quarter_and_region.sql'),
      'utf8',
    )
    await db.exec(SQL_030)   // should not throw
    // Confirm the row count is unchanged.
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases`,
    )
    expect(r.rows[0]!.n).toBe(22)
  })

  it('attempting to INSERT a true duplicate (same effective key) is rejected', async () => {
    // Try to insert a second row with the same identity as the
    // existing "Pokémon TCG: Mega Evolution—Delta Reign" row.
    let threw = false
    try {
      await db.exec(
        `insert into public.network_tcg_releases
           (tcg, site_slug, set_name, set_code, product_type, language, region,
            release_date, release_date_precision, confirmation_status,
            verification_mode, review_status)
         values
           ('pokemon','pokemon',
            'Pokémon TCG: Mega Evolution—Delta Reign', null,
            'expansion','en','US',
            '2027-01-01','day','confirmed',
            'manual','approved')`,
      )
    } catch { threw = true }
    expect(threw).toBe(true)
  })

  it('attempting to INSERT a legit new no-code release is allowed', async () => {
    // Different set_name → different effective key → insert succeeds.
    await db.exec(
      `insert into public.network_tcg_releases
         (tcg, site_slug, set_name, set_code, product_type, language, region,
          release_date, release_date_precision, confirmation_status,
          verification_mode, review_status)
       values
         ('pokemon','pokemon',
          'Legit new Pokémon release without code', null,
          'expansion','en','US',
          '2027-05-01','day','confirmed',
          'manual','approved')`,
    )
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases
         where set_name = 'Legit new Pokémon release without code'`,
    )
    expect(r.rows[0]!.n).toBe(1)
    // Cleanup so other tests in this file are unaffected.
    await db.exec(
      `delete from public.network_tcg_releases
         where set_name = 'Legit new Pokémon release without code'`,
    )
  })
})

describe('unified migration · constraints still fire', () => {
  it('release_date_precision rejects unknown values', async () => {
    let threw = false
    try {
      await db.exec(
        `insert into public.network_tcg_releases
           (tcg, site_slug, set_name, set_code, product_type, language,
            release_date, release_date_precision, confirmation_status,
            verification_mode, review_status)
         values
           ('mtg','mtg','Bad precision probe','BADX',
            'expansion','en','2027-07-01','year','announced_tbc',
            'manual','approved')`,
      )
    } catch { threw = true }
    expect(threw).toBe(true)
  })

  it('release_date_precision accepts quarter', async () => {
    await db.exec(
      `insert into public.network_tcg_releases
         (tcg, site_slug, set_name, set_code, product_type, language,
          release_date, release_date_precision, confirmation_status,
          verification_mode, review_status)
       values
         ('mtg','mtg','Quarter insert probe','QIPX',
          'expansion','en','2027-07-01','quarter','announced_tbc',
          'manual','approved')`,
    )
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases where set_code = 'QIPX'`,
    )
    expect(r.rows[0]!.n).toBe(1)
    await db.exec(`delete from public.network_tcg_releases where set_code = 'QIPX'`)
  })

  it('review_status rejects unknown values', async () => {
    let threw = false
    try {
      await db.exec(
        `insert into public.network_tcg_releases
           (tcg, site_slug, set_name, set_code, product_type, language,
            release_date, release_date_precision, confirmation_status,
            verification_mode, review_status)
         values
           ('mtg','mtg','Bad review probe','BADR',
            'expansion','en','2027-07-01','day','announced_tbc',
            'manual','maybe')`,
      )
    } catch { threw = true }
    expect(threw).toBe(true)
  })
})
