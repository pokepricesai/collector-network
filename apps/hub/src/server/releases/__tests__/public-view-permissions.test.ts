import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// CN-06.06 corrections pass 2 · executed-SQL permission tests.
//
// Companion to review-gate.test.ts (SQL-contract regex) and
// ingester-gate.test.ts (Supabase client stubs). This file applies
// the migrations to an in-process PGlite instance, inserts
// fixtures covering every gate state, then switches role to anon
// and asserts the actual runtime visibility.
//
// What this catches that contract/regex tests do NOT:
//   - A subtly mis-spelled GRANT or REVOKE
//   - A view that accidentally projects an operator-only column
//   - A pending/rejected/cancelled/child/proposed-change row
//     being visible via the public view in practice
//   - Direct access to admin-only base tables as anon
//   - Operator-only column data leaking through the view

const BASE_RELEASES_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261029000000_tcg_releases.sql'),
  'utf8',
)

const PUBLIC_VIEW_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261107000000_releases_public_view.sql'),
  'utf8',
)

const REVIEW_GATE_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261107010000_releases_review_gate.sql'),
  'utf8',
)

const QUARTER_REGION_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261107030000_releases_quarter_and_region.sql'),
  'utf8',
)

// Not applied in this test — seed rows are not needed for the
// permission assertions and would pull in generated UUIDs that
// are not stable across runs. We insert bespoke fixtures below.

/** PGlite doesn't ship with Supabase's `anon` / `authenticated`
 *  roles, nor with the network_admin_users table + network_is_admin()
 *  function referenced by the base migration. We stub them
 *  minimally so the migrations run end-to-end, preserving the
 *  parts we care about testing (view DDL + GRANTs + CHECK
 *  constraints). */
const STUB_SQL = `
-- Create roles matching the Supabase convention so GRANT lines
-- don't fail. In production, Supabase provisions these roles
-- automatically with its own RLS+JWT bindings; here we just
-- need them to exist so GRANT/REVOKE compile.
create role anon;
create role authenticated;

-- Stub network_admin_users + network_is_admin() so the base
-- migration's RLS policies + FK references compile. The policies
-- themselves won't fire in the test (we bypass RLS by connecting
-- as the owner by default), but the DDL must parse.
create table if not exists public.network_admin_users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function public.network_is_admin()
returns boolean language sql stable as $$ select false $$;
`

// Fixture generator — creates one row of every gate state. The
// base-table unique constraint allows multiple rows per TCG with
// distinct set_codes, so each fixture uses a unique code.
function fixturesSql() {
  return `
    -- 1. Approved + confirmed — expected VISIBLE in public view.
    insert into public.network_tcg_releases
      (tcg, site_slug, set_name, set_code, product_type, language,
       release_date, release_date_precision, confirmation_status,
       source_url, source_notes, verification_mode, review_status)
    values
      ('mtg', 'mtg', 'Approved Confirmed Fixture', 'AC01',
       'expansion', 'en',
       '2027-05-01', 'day', 'confirmed',
       'https://example.publisher/ac01',
       'INTERNAL: operator diagnostic notes that must NEVER leak',
       'manual', 'approved');

    -- 2. Pending review — expected INVISIBLE publicly.
    insert into public.network_tcg_releases
      (tcg, site_slug, set_name, set_code, product_type, language,
       release_date, release_date_precision, confirmation_status,
       source_url, verification_mode, review_status)
    values
      ('mtg', 'mtg', 'Pending Review Fixture', 'PR01',
       'expansion', 'en',
       '2027-05-02', 'day', 'confirmed',
       'https://example.publisher/pr01', 'automated', 'pending_review');

    -- 3. Rejected — expected INVISIBLE publicly.
    insert into public.network_tcg_releases
      (tcg, site_slug, set_name, set_code, product_type, language,
       release_date, release_date_precision, confirmation_status,
       source_url, verification_mode, review_status)
    values
      ('mtg', 'mtg', 'Rejected Fixture', 'RJ01',
       'expansion', 'en',
       '2027-05-03', 'day', 'confirmed',
       'https://example.publisher/rj01', 'automated', 'rejected');

    -- 4. Cancelled — expected INVISIBLE publicly (confirmation_status filter).
    insert into public.network_tcg_releases
      (tcg, site_slug, set_name, set_code, product_type, language,
       release_date, release_date_precision, confirmation_status,
       source_url, verification_mode, review_status)
    values
      ('mtg', 'mtg', 'Cancelled Fixture', 'CA01',
       'expansion', 'en',
       '2027-05-04', 'day', 'cancelled',
       'https://example.publisher/ca01', 'manual', 'approved');

    -- 5. Rumoured — expected INVISIBLE publicly (confirmation_status filter).
    insert into public.network_tcg_releases
      (tcg, site_slug, set_name, set_code, product_type, language,
       release_date, release_date_precision, confirmation_status,
       source_url, verification_mode, review_status)
    values
      ('mtg', 'mtg', 'Rumoured Fixture', 'RM01',
       'expansion', 'en',
       '2027-05-05', 'day', 'rumoured',
       'https://example.publisher/rm01', 'manual', 'approved');

    -- 6. Approved + has UNAPPROVED date change proposal — expected
    --    VISIBLE but public view must serve the APPROVED date,
    --    NOT the proposed one; the proposed_release_date column
    --    must not appear in the projection.
    insert into public.network_tcg_releases
      (tcg, site_slug, set_name, set_code, product_type, language,
       release_date, release_date_precision, confirmation_status,
       source_url, verification_mode, review_status,
       proposed_release_date, proposed_release_date_precision,
       proposed_change_at, proposed_change_source)
    values
      ('mtg', 'mtg', 'Approved With Proposal Fixture', 'AP01',
       'expansion', 'en',
       '2027-06-01', 'day', 'confirmed',
       'https://example.publisher/ap01', 'automated', 'approved',
       '2027-07-15', 'day', now(), 'ingestion:test');

    -- 7. Child / sub-product — expected INVISIBLE in the primary
    --    public view (surfaces in the subproducts view instead).
    --    Parent is AC01 above.
    insert into public.network_tcg_releases
      (tcg, site_slug, set_name, set_code, product_type, language,
       release_date, release_date_precision, confirmation_status,
       source_url, verification_mode, review_status,
       parent_release_id)
    values
      ('mtg', 'mtg', 'Child Of Approved Fixture', 'CH01',
       'premium', 'en',
       '2027-05-01', 'day', 'confirmed',
       'https://example.publisher/ch01', 'manual', 'approved',
       (select id from public.network_tcg_releases where set_code = 'AC01'));

    -- 8. Quarter-precision approved — expected VISIBLE; precision
    --    column must round-trip through the view.
    insert into public.network_tcg_releases
      (tcg, site_slug, set_name, set_code, product_type, language,
       release_date, release_date_precision, confirmation_status,
       source_url, verification_mode, review_status)
    values
      ('lorcana', 'lorcana', 'Quarter Fixture', 'QT01',
       'expansion', 'en',
       '2027-04-01', 'quarter', 'announced_tbc',
       'https://example.publisher/qt01', 'manual', 'approved');
  `
}

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUB_SQL)
  await db.exec(BASE_RELEASES_SQL)
  await db.exec(PUBLIC_VIEW_SQL)
  await db.exec(REVIEW_GATE_SQL)
  await db.exec(QUARTER_REGION_SQL)
  await db.exec(fixturesSql())
}, 60_000)

afterAll(async () => {
  await db.close()
})

// ─────────────────── Public view visibility ───────────────────

describe('executed SQL: network_tcg_releases_public visibility', () => {
  it('returns only approved + public-confirmation + primary rows', async () => {
    const r = await db.query<{ set_code: string; confirmation_status: string }>(
      `select set_code, confirmation_status
         from public.network_tcg_releases_public
         order by set_code`,
    )
    const codes = r.rows.map((x) => x.set_code).filter((c) => c != null)
    // Expected VISIBLE: AC01 (approved confirmed), AP01 (approved
    // with pending proposal — serves approved date), QT01
    // (approved quarter-precision). Three rows.
    expect(codes).toEqual(['AC01', 'AP01', 'QT01'])
  })

  it('excludes pending_review rows', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases_public where set_code = 'PR01'`,
    )
    expect(r.rows[0]!.n).toBe(0)
  })

  it('excludes rejected rows', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases_public where set_code = 'RJ01'`,
    )
    expect(r.rows[0]!.n).toBe(0)
  })

  it('excludes cancelled rows even when review_status=approved', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases_public where set_code = 'CA01'`,
    )
    expect(r.rows[0]!.n).toBe(0)
  })

  it('excludes rumoured rows even when review_status=approved', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases_public where set_code = 'RM01'`,
    )
    expect(r.rows[0]!.n).toBe(0)
  })

  it('excludes child rows (parent_release_id IS NOT NULL)', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases_public where set_code = 'CH01'`,
    )
    expect(r.rows[0]!.n).toBe(0)
  })

  it('serves the approved release_date, NOT the proposed one', async () => {
    const r = await db.query<{ release_date: string }>(
      `select release_date::text as release_date from public.network_tcg_releases_public where set_code = 'AP01'`,
    )
    expect(r.rows[0]!.release_date).toBe('2027-06-01')  // the APPROVED value
  })

  it('round-trips quarter precision through the view', async () => {
    const r = await db.query<{ release_date_precision: string; release_date: string }>(
      `select release_date_precision, release_date::text as release_date
         from public.network_tcg_releases_public where set_code = 'QT01'`,
    )
    expect(r.rows[0]!.release_date_precision).toBe('quarter')
    expect(r.rows[0]!.release_date).toBe('2027-04-01')
  })
})

// ─────────────────── Operator-only columns ───────────────────

describe('executed SQL: operator-only column projection', () => {
  it('view does NOT expose source_notes', async () => {
    const r = await db.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'network_tcg_releases_public'
           and column_name = 'source_notes'
       ) as exists`,
    )
    expect(r.rows[0]!.exists).toBe(false)
  })

  it('view does NOT expose source_verified_at', async () => {
    const r = await db.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'network_tcg_releases_public'
           and column_name = 'source_verified_at'
       ) as exists`,
    )
    expect(r.rows[0]!.exists).toBe(false)
  })

  it('view does NOT expose verification_mode', async () => {
    const r = await db.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'network_tcg_releases_public'
           and column_name = 'verification_mode'
       ) as exists`,
    )
    expect(r.rows[0]!.exists).toBe(false)
  })

  it('view does NOT expose review_status', async () => {
    const r = await db.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'network_tcg_releases_public'
           and column_name = 'review_status'
       ) as exists`,
    )
    expect(r.rows[0]!.exists).toBe(false)
  })

  it('view does NOT expose proposed_* columns', async () => {
    const r = await db.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'network_tcg_releases_public'
           and column_name like 'proposed_%'
       ) as exists`,
    )
    expect(r.rows[0]!.exists).toBe(false)
  })

  it('view does NOT expose metadata / created_by / updated_by / created_at', async () => {
    for (const col of ['metadata', 'created_by', 'updated_by', 'created_at']) {
      const r = await db.query<{ exists: boolean }>(
        `select exists (
           select 1 from information_schema.columns
           where table_schema = 'public'
             and table_name = 'network_tcg_releases_public'
             and column_name = $1
         ) as exists`,
        [col],
      )
      expect(r.rows[0]!.exists, `column ${col} unexpectedly exposed`).toBe(false)
    }
  })

  it('operator notes stored on the approved row do not leak', async () => {
    // Direct the fixture inserted explicit INTERNAL notes on AC01.
    // The public view must have no textual trace of it.
    const r = await db.query<Record<string, unknown>>(
      `select * from public.network_tcg_releases_public where set_code = 'AC01'`,
    )
    const serialized = JSON.stringify(r.rows[0] ?? {})
    expect(serialized.includes('INTERNAL:')).toBe(false)
    expect(serialized.includes('operator diagnostic')).toBe(false)
  })
})

// ─────────────── Anonymous role access ───────────────

describe('executed SQL: anon role access', () => {
  it('anon CAN SELECT from the public view', async () => {
    // RESET then SET ROLE anon; SELECT; RESET.
    await db.exec(`reset role; set role anon;`)
    try {
      const r = await db.query<{ n: number }>(
        `select count(*)::int as n from public.network_tcg_releases_public`,
      )
      expect(r.rows[0]!.n).toBeGreaterThan(0)
    } finally {
      await db.exec(`reset role;`)
    }
  })

  it('anon CANNOT SELECT from the base network_tcg_releases table', async () => {
    // The base migration enables RLS admin-only. network_is_admin()
    // returns false for anon. In addition, PGlite enforces a
    // table-level GRANT: anon has no SELECT privilege on the base
    // table (no GRANT was issued), so the query is rejected hard
    // with "permission denied for table network_tcg_releases".
    // Either outcome satisfies the brief: anon sees NONE of the
    // 8 fixture rows via direct base-table access.
    await db.exec(`reset role; set role anon;`)
    let sawRows = -1
    let threw = false
    try {
      const r = await db.query<{ n: number }>(
        `select count(*)::int as n from public.network_tcg_releases`,
      )
      sawRows = r.rows[0]!.n
    } catch (err) {
      threw = true
      expect(String((err as Error).message)).toMatch(/permission denied|not allowed/i)
    } finally {
      await db.exec(`reset role;`)
    }
    // Accept both semantics:
    //   - Hard-deny via GRANT (threw=true)
    //   - RLS filter returns zero rows (threw=false AND sawRows=0)
    if (!threw) expect(sawRows).toBe(0)
  })

  it('anon CANNOT INSERT into the base table', async () => {
    await db.exec(`reset role; set role anon;`)
    let threw = false
    try {
      await db.exec(
        `insert into public.network_tcg_releases
           (tcg, site_slug, set_name, product_type, language,
            confirmation_status, verification_mode, review_status)
         values ('mtg','mtg','anon injection attempt','expansion','en',
                 'confirmed','manual','approved')`,
      )
    } catch { threw = true } finally { await db.exec(`reset role;`) }
    // Either an explicit error or a silent row-rejection by RLS.
    // We assert by re-querying for the fixture: it must not exist.
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases
         where set_name = 'anon injection attempt'`,
    )
    expect(r.rows[0]!.n).toBe(0)
    void threw
  })

  it('anon CAN SELECT from the subproducts view, filtered to approved parents', async () => {
    await db.exec(`reset role; set role anon;`)
    try {
      const r = await db.query<{ set_code: string }>(
        `select set_code from public.network_tcg_releases_subproducts
           order by set_code`,
      )
      // The CH01 child is approved + its parent AC01 is approved +
      // the child's confirmation_status is public-safe, so the
      // subproducts view returns it.
      expect(r.rows.map((x) => x.set_code)).toEqual(['CH01'])
    } finally {
      await db.exec(`reset role;`)
    }
  })
})

// ─────────────── Schema-level invariants ───────────────

describe('executed SQL: schema invariants', () => {
  it('release_date_precision CHECK accepts quarter', async () => {
    // A valid quarter-precision row should insert cleanly.
    await db.exec(
      `insert into public.network_tcg_releases
         (tcg, site_slug, set_name, set_code, product_type, language,
          release_date, release_date_precision, confirmation_status,
          verification_mode, review_status)
       values
         ('mtg','mtg','Quarter insert probe','QIP',
          'expansion','en','2027-07-01','quarter','announced_tbc',
          'manual','approved')`,
    )
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases where set_code = 'QIP'`,
    )
    expect(r.rows[0]!.n).toBe(1)
  })

  it('release_date_precision CHECK rejects unknown values', async () => {
    let threw = false
    try {
      await db.exec(
        `insert into public.network_tcg_releases
           (tcg, site_slug, set_name, set_code, product_type, language,
            release_date, release_date_precision, confirmation_status,
            verification_mode, review_status)
         values
           ('mtg','mtg','Bad precision probe','BAD',
            'expansion','en','2027-07-01','year','announced_tbc',
            'manual','approved')`,
      )
    } catch { threw = true }
    expect(threw).toBe(true)
  })

  it('region-aware unique key allows EU + NA rows with same set_code', async () => {
    // Insert a Magnificent-Maestros-style pair.
    await db.exec(
      `insert into public.network_tcg_releases
         (tcg, site_slug, set_name, set_code, product_type, language, region,
          release_date, release_date_precision, confirmation_status,
          verification_mode, review_status)
       values
         ('ygo','ygo','Region Probe','RGN',
          'booster','en','EU','2027-01-01','day','confirmed',
          'manual','approved'),
         ('ygo','ygo','Region Probe','RGN',
          'booster','en','NA','2027-01-02','day','confirmed',
          'manual','approved')`,
    )
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.network_tcg_releases where set_code = 'RGN'`,
    )
    expect(r.rows[0]!.n).toBe(2)
  })

  it('region-aware unique key still rejects duplicate (tcg, set_code, language, region)', async () => {
    let threw = false
    try {
      await db.exec(
        `insert into public.network_tcg_releases
           (tcg, site_slug, set_name, set_code, product_type, language, region,
            release_date, release_date_precision, confirmation_status,
            verification_mode, review_status)
         values
           ('ygo','ygo','Duplicate probe','RGN',
            'booster','en','EU','2027-01-05','day','confirmed',
            'manual','approved')`,
      )
    } catch { threw = true }
    expect(threw).toBe(true)
  })

  it('no-self-parent CHECK fires on UPDATE that would self-parent', async () => {
    const parent = await db.query<{ id: string }>(
      `select id from public.network_tcg_releases where set_code = 'AC01'`,
    )
    const id = parent.rows[0]!.id
    let threw = false
    try {
      await db.exec(
        `update public.network_tcg_releases
           set parent_release_id = $1
           where id = $1`,
        [id],
      )
    } catch { threw = true }
    expect(threw).toBe(true)
  })
})
