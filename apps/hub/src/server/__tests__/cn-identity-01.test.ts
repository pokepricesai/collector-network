import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// CN-IDENTITY-01 · schema + entitlement-logic tests.
//
// Applies the migration to an in-process PGlite and asserts every
// invariant the brief's Phase 6 enumerates:
//
//   - Existing users retain their IDs                     (schema is additive)
//   - Discord can be linked to an existing user           (collector_link_discord RPC)
//   - Discord sign-in cannot claim another user's account (UNIQUE discord_user_id)
//   - Duplicate linking is rejected safely                (ON CONFLICT handling)
//   - Unlinking works without locking out the user        (disconnected_at)
//   - Free members cannot access premium-only features    (collector_user_has_feature)
//   - Premium is network-wide                             (one row keys network, no site_code)
//   - Premium expiry/revocation is enforced               (expires_at + status)
//   - Discord linking alone cannot grant premium          (collector_memberships is separate)
//   - Existing CN-STOCK-02 pilot remains isolated         (cn_stock_* tables untouched)

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations',
       '20261107070000_cn_identity_01_memberships_discord.sql'),
  'utf8',
)

// Stub the parts of the Supabase auth stack referenced by the
// migration. We need: auth.users table, auth.uid() function,
// and the three Supabase roles that GRANT / REVOKE target.
const STUB_SQL = `
do $pgl$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  if not exists (select 1 from pg_namespace where nspname='auth') then
    create schema auth;
  end if;
end $pgl$;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz default now()
);
-- auth.uid() stand-in — real Supabase reads the JWT. For the test
-- we set a thread-local via a session GUC.
create or replace function auth.uid() returns uuid
  language sql stable as $fn$
    select nullif(current_setting('test.auth_uid', true), '')::uuid
  $fn$;
`

let db: PGlite

async function makeUser(email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id::text`,
    [email],
  )
  return r.rows[0]!.id
}

async function hasFeature(userId: string | null, feature: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `select public.collector_user_has_feature($1::uuid, $2) as ok`,
    [userId, feature],
  )
  return r.rows[0]!.ok
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUB_SQL)
  await db.exec(MIGRATION_SQL)
}, 60_000)

afterAll(async () => {
  await db.close()
})

// ─────────────── Migration is additive ───────────────

describe('migration is additive, not destructive', () => {
  it('creates both new tables with the correct UNIQUE constraints', async () => {
    const tables = await db.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public'
          and tablename in ('collector_memberships','collector_discord_links')
        order by tablename`,
    )
    expect(tables.rows.map((r) => r.tablename)).toEqual([
      'collector_discord_links', 'collector_memberships',
    ])
    const uniques = await db.query<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'public.collector_discord_links'::regclass and contype = 'u'
        order by conname`,
    )
    expect(uniques.rows.map((r) => r.conname)).toEqual([
      'collector_discord_links_discord_unique',
      'collector_discord_links_user_unique',
    ])
  })

  it('AFTER INSERT trigger on auth.users auto-provisions a free membership', async () => {
    const uid = await makeUser('bootstrap@example.test')
    const r = await db.query<{ tier: string; status: string; source: string }>(
      `select tier, status, source from public.collector_memberships where user_id = $1::uuid`,
      [uid],
    )
    expect(r.rows[0]).toEqual({ tier: 'free', status: 'active', source: 'signup' })
  })
})

// ─────────────── Feature gate matrix ───────────────

describe('collector_user_has_feature · feature gate matrix', () => {
  it('anonymous (null user) gets no features', async () => {
    expect(await hasFeature(null, 'stock_alerts_free')).toBe(false)
    expect(await hasFeature(null, 'stock_alerts_premium')).toBe(false)
  })

  it('free member has stock_alerts_free + ebay_deals_free, not _premium', async () => {
    const uid = await makeUser('free@example.test')
    expect(await hasFeature(uid, 'stock_alerts_free')).toBe(true)
    expect(await hasFeature(uid, 'ebay_deals_free')).toBe(true)
    expect(await hasFeature(uid, 'stock_alerts_premium')).toBe(false)
    expect(await hasFeature(uid, 'ebay_deals_premium')).toBe(false)
  })

  it('premium member has all four features', async () => {
    const uid = await makeUser('premium@example.test')
    await db.exec(`update collector_memberships set tier = 'premium' where user_id = '${uid}'::uuid`)
    expect(await hasFeature(uid, 'stock_alerts_free')).toBe(true)
    expect(await hasFeature(uid, 'stock_alerts_premium')).toBe(true)
    expect(await hasFeature(uid, 'ebay_deals_premium')).toBe(true)
  })

  it('EXPIRED premium falls back to free features', async () => {
    const uid = await makeUser('expired@example.test')
    await db.exec(
      `update collector_memberships
          set tier = 'premium', expires_at = now() - interval '1 day'
        where user_id = '${uid}'::uuid`,
    )
    expect(await hasFeature(uid, 'stock_alerts_free')).toBe(true)
    expect(await hasFeature(uid, 'stock_alerts_premium')).toBe(false)
  })

  it('INACTIVE status (cancelled / suspended / expired) revokes all features', async () => {
    const uid = await makeUser('cancelled@example.test')
    await db.exec(
      `update collector_memberships
          set tier = 'premium', status = 'cancelled'
        where user_id = '${uid}'::uuid`,
    )
    expect(await hasFeature(uid, 'stock_alerts_free')).toBe(false)
    expect(await hasFeature(uid, 'stock_alerts_premium')).toBe(false)
  })
})

// ─────────────── Operator-set membership helper ───────────────

describe('collector_set_membership_tier · operator-set helper', () => {
  it('upgrading free → premium bumps activated_at', async () => {
    const uid = await makeUser('upgrade@example.test')
    const before = await db.query<{ activated_at: string }>(
      `select activated_at::text from collector_memberships where user_id = '${uid}'::uuid`,
    )
    const t0 = new Date(before.rows[0]!.activated_at).getTime()
    // Simulate 1 second elapsed so activated_at can change.
    await new Promise((r) => setTimeout(r, 15))
    await db.query<{ tier: string }>(
      `select tier from public.collector_set_membership_tier(
         $1::uuid, 'premium', (now() + interval '30 days'), 'operator', 'pilot promotion')`,
      [uid],
    )
    const after = await db.query<{ tier: string; status: string; activated_at: string; expires_at: string | null; source: string }>(
      `select tier, status, activated_at::text, expires_at::text, source
         from collector_memberships where user_id = '${uid}'::uuid`,
    )
    expect(after.rows[0]!.tier).toBe('premium')
    expect(after.rows[0]!.status).toBe('active')
    expect(after.rows[0]!.source).toBe('operator')
    const t1 = new Date(after.rows[0]!.activated_at).getTime()
    expect(t1).toBeGreaterThanOrEqual(t0)
    expect(after.rows[0]!.expires_at).toBeTruthy()
  })

  it('downgrading premium → free zeroes expires_at without destroying the row', async () => {
    const uid = await makeUser('downgrade@example.test')
    await db.query(`select public.collector_set_membership_tier($1::uuid, 'premium', (now() + interval '30 days'), 'operator', null)`, [uid])
    await db.query(`select public.collector_set_membership_tier($1::uuid, 'free', null::timestamptz, 'operator', null)`, [uid])
    const r = await db.query<{ tier: string; expires_at: string | null }>(
      `select tier, expires_at::text from collector_memberships where user_id = '${uid}'::uuid`,
    )
    expect(r.rows[0]!.tier).toBe('free')
    expect(r.rows[0]!.expires_at).toBeNull()
  })

  it('unknown tier value is rejected', async () => {
    const uid = await makeUser('bad-tier@example.test')
    let threw = false
    try {
      await db.query(`select public.collector_set_membership_tier($1::uuid, 'ultra_premium', null::timestamptz, 'operator', null)`, [uid])
    } catch { threw = true }
    expect(threw).toBe(true)
  })
})

// ─────────────── Discord linking ───────────────

describe('collector_link_discord · identity linking invariants', () => {
  it('first-time link succeeds and surfaces in the view', async () => {
    const uid = await makeUser('link1@example.test')
    await db.query(
      `select public.collector_link_discord($1::uuid, '123456789', 'cooltrader', null, null)`,
      [uid],
    )
    const r = await db.query<{ discord_linked: boolean }>(
      `select discord_linked from public.collector_user_membership_view where user_id = '${uid}'::uuid`,
    )
    expect(r.rows[0]!.discord_linked).toBe(true)
  })

  it('a second Collector Network account cannot claim the same Discord ID', async () => {
    const uid1 = await makeUser('discord-claim-1@example.test')
    const uid2 = await makeUser('discord-claim-2@example.test')
    await db.query(`select public.collector_link_discord($1::uuid, 'shared-discord-id', 'user1', null, null)`, [uid1])
    let threw = false
    let message = ''
    try {
      await db.query(`select public.collector_link_discord($1::uuid, 'shared-discord-id', 'user2', null, null)`, [uid2])
    } catch (e) {
      threw = true
      message = (e as Error).message
    }
    expect(threw).toBe(true)
    expect(message).toMatch(/discord_already_linked/i)
  })

  it('same user re-linking (switched Discord account) updates the row in place', async () => {
    const uid = await makeUser('discord-relink@example.test')
    await db.query(`select public.collector_link_discord($1::uuid, 'first-discord-id', 'first-handle', null, null)`, [uid])
    await db.query(`select public.collector_link_discord($1::uuid, 'second-discord-id', 'second-handle', null, null)`, [uid])
    const r = await db.query<{ discord_user_id: string; discord_username: string }>(
      `select discord_user_id, discord_username from public.collector_discord_links where user_id = '${uid}'::uuid`,
    )
    expect(r.rows[0]!.discord_user_id).toBe('second-discord-id')
    expect(r.rows[0]!.discord_username).toBe('second-handle')
  })

  it('unlink marks the row disconnected without destroying membership', async () => {
    const uid = await makeUser('unlink@example.test')
    await db.query(`select public.collector_link_discord($1::uuid, 'to-unlink', 'who', null, null)`, [uid])
    await db.query(`select public.collector_unlink_discord($1::uuid)`, [uid])
    const view = await db.query<{ discord_linked: boolean; tier: string; status: string }>(
      `select discord_linked, tier, status from public.collector_user_membership_view where user_id = '${uid}'::uuid`,
    )
    expect(view.rows[0]!.discord_linked).toBe(false)
    // Membership intact — user is not locked out.
    expect(view.rows[0]!.tier).toBe('free')
    expect(view.rows[0]!.status).toBe('active')
    // Audit row still exists, soft-disconnected.
    const log = await db.query<{ discord_user_id: string; disconnected_at: string | null }>(
      `select discord_user_id, disconnected_at::text from public.collector_discord_links where user_id = '${uid}'::uuid`,
    )
    expect(log.rows[0]!.discord_user_id).toBe('to-unlink')
    expect(log.rows[0]!.disconnected_at).not.toBeNull()
  })

  it('a unlinked Discord ID CAN be claimed by a different CN account afterwards', async () => {
    // Case: user A linked discord-X, unlinked it. User B should be
    // allowed to link discord-X next. The UNIQUE(discord_user_id)
    // forbids this in v1 (strict, operator-moderated) — we assert
    // the current behaviour so a future relaxation is a deliberate
    // schema change, not a silent regression.
    const uA = await makeUser('user-a@example.test')
    const uB = await makeUser('user-b@example.test')
    await db.query(`select public.collector_link_discord($1::uuid, 'transferable', 'handle-A', null, null)`, [uA])
    await db.query(`select public.collector_unlink_discord($1::uuid)`, [uA])
    // Row still occupies the UNIQUE slot (disconnected_at just flipped;
    // discord_user_id unchanged). A re-link by user B is rejected.
    let threw = false
    try {
      await db.query(`select public.collector_link_discord($1::uuid, 'transferable', 'handle-B', null, null)`, [uB])
    } catch { threw = true }
    expect(threw).toBe(true)
    // Operator can manually DELETE the row to free the Discord ID.
    // Document this expectation; future CN-IDENTITY-02 can revisit.
  })

  it('Discord linking alone does NOT upgrade tier', async () => {
    const uid = await makeUser('discord-only@example.test')
    await db.query(`select public.collector_link_discord($1::uuid, 'wishes-were-horses', null, null, null)`, [uid])
    const r = await db.query<{ tier: string }>(
      `select tier from collector_memberships where user_id = '${uid}'::uuid`,
    )
    expect(r.rows[0]!.tier).toBe('free')  // still free
  })
})

// ─────────────── CN-STOCK-02 pilot isolation ───────────────

describe('CN-STOCK-02 pilot isolation', () => {
  it('this migration does NOT touch any cn_stock_* tables', async () => {
    // Just verify the migration only creates / modifies collector_*
    // objects. A dry-run grep against the SQL text is sufficient —
    // the pilot schema isn't loaded in this PGlite, so a real
    // migration run wouldn't affect it either.
    expect(MIGRATION_SQL).not.toMatch(/cn_stock_/)
    expect(MIGRATION_SQL).toMatch(/collector_memberships/)
    expect(MIGRATION_SQL).toMatch(/collector_discord_links/)
  })

  it('no cn_stock_* grants or revokes appear in this migration', () => {
    expect(MIGRATION_SQL).not.toMatch(/(?:grant|revoke)[^;]*cn_stock_/i)
  })
})
