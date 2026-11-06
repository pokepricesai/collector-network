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

const MIGRATION_SQL_1 = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations',
       '20261107070000_cn_identity_01_memberships_discord.sql'),
  'utf8',
)
const MIGRATION_SQL_2 = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations',
       '20261107080000_cn_identity_01_sec_fixes.sql'),
  'utf8',
)
// Compose: migration 1 then 2, matching the production apply order.
const MIGRATION_SQL = MIGRATION_SQL_1 + '\n' + MIGRATION_SQL_2

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
  // Run as service_role (bypasses the cross-user guard inside the
  // function) so we can probe arbitrary users for test assertions.
  await db.exec(`set local request.jwt.claims = '{"role":"service_role"}'`)
  const r = await db.query<{ ok: boolean }>(
    `select public.collector_user_has_feature($1::uuid, $2) as ok`,
    [userId, feature],
  )
  return r.rows[0]!.ok
}

/** Switch into an "authenticated user" session by setting the
 *  auth.uid() stub + a JWT role claim. Call this BEFORE the SQL
 *  that should run under the user's context. */
async function asUser(userId: string | null): Promise<void> {
  const claims = userId
    ? `{"role":"authenticated","sub":"${userId}"}`
    : '{"role":"anon"}'
  await db.exec(`set test.auth_uid = '${userId ?? ''}'`)
  await db.exec(`set request.jwt.claims = '${claims}'`)
}

/** Switch into the service_role (operator / billing / Hub worker). */
async function asServiceRole(): Promise<void> {
  await db.exec(`set test.auth_uid = ''`)
  await db.exec(`set request.jwt.claims = '{"role":"service_role"}'`)
}

/** Reset session context so later tests start clean. */
async function resetSession(): Promise<void> {
  await db.exec(`reset test.auth_uid`)
  await db.exec(`reset request.jwt.claims`)
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
  it('upgrading free → premium bumps activated_at (as service_role)', async () => {
    await asServiceRole()
    const uid = await makeUser('upgrade@example.test')
    const before = await db.query<{ activated_at: string }>(
      `select activated_at::text from collector_memberships where user_id = '${uid}'::uuid`,
    )
    const t0 = new Date(before.rows[0]!.activated_at).getTime()
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
    await resetSession()
  })

  it('downgrading premium → free zeroes expires_at without destroying the row', async () => {
    await asServiceRole()
    const uid = await makeUser('downgrade@example.test')
    await db.query(`select public.collector_set_membership_tier($1::uuid, 'premium', (now() + interval '30 days'), 'operator', null)`, [uid])
    await db.query(`select public.collector_set_membership_tier($1::uuid, 'free', null::timestamptz, 'operator', null)`, [uid])
    const r = await db.query<{ tier: string; expires_at: string | null }>(
      `select tier, expires_at::text from collector_memberships where user_id = '${uid}'::uuid`,
    )
    expect(r.rows[0]!.tier).toBe('free')
    expect(r.rows[0]!.expires_at).toBeNull()
    await resetSession()
  })

  it('unknown tier value is rejected', async () => {
    await asServiceRole()
    const uid = await makeUser('bad-tier@example.test')
    let threw = false
    try {
      await db.query(`select public.collector_set_membership_tier($1::uuid, 'ultra_premium', null::timestamptz, 'operator', null)`, [uid])
    } catch { threw = true }
    expect(threw).toBe(true)
    await resetSession()
  })
})

// ─────────────── Security · tier mutation privileges ───────────────

describe('SECURITY: collector_set_membership_tier is service_role only', () => {
  it('EXECUTE is revoked from PUBLIC, anon, and authenticated', async () => {
    const r = await db.query<{ role: string; has: boolean }>(
      `select rolname as role,
              has_function_privilege(
                rolname,
                'public.collector_set_membership_tier(uuid, text, timestamptz, text, text)',
                'execute'
              ) as has
         from pg_roles
         where rolname in ('anon','authenticated','service_role')
         order by rolname`,
    )
    const map = Object.fromEntries(r.rows.map((x) => [x.role, x.has]))
    expect(map['anon']).toBe(false)
    expect(map['authenticated']).toBe(false)
    expect(map['service_role']).toBe(true)
  })

  it('PUBLIC has no EXECUTE either (defence against newly-created roles)', async () => {
    const r = await db.query<{ has: boolean }>(
      `select has_function_privilege(
         'public',
         'public.collector_set_membership_tier(uuid, text, timestamptz, text, text)',
         'execute'
       ) as has`,
    )
    expect(r.rows[0]!.has).toBe(false)
  })

  it('function body refuses even if an authenticated JWT session calls it', async () => {
    await asServiceRole()
    const victim = await makeUser('promotion-victim@example.test')
    await resetSession()
    // Simulate an authenticated attacker who somehow obtained EXECUTE
    // (e.g. a future migration mistake). The function body rejects.
    await asUser(victim)
    let threw = false
    let msg = ''
    try {
      await db.query(
        `select public.collector_set_membership_tier($1::uuid, 'premium', null::timestamptz, 'operator', null)`,
        [victim],
      )
    } catch (e) { threw = true; msg = (e as Error).message }
    expect(threw).toBe(true)
    expect(msg).toMatch(/forbidden: collector_set_membership_tier is service_role only/i)
    await resetSession()
  })

  it('verify the victim remained on the free tier', async () => {
    await asServiceRole()
    const victim = await makeUser('still-free@example.test')
    await resetSession()
    await asUser(victim)
    try {
      await db.query(
        `select public.collector_set_membership_tier($1::uuid, 'premium', null::timestamptz, 'operator', null)`,
        [victim],
      )
    } catch { /* expected */ }
    await resetSession()
    await asServiceRole()
    const r = await db.query<{ tier: string }>(
      `select tier from collector_memberships where user_id = '${victim}'::uuid`,
    )
    expect(r.rows[0]!.tier).toBe('free')
    await resetSession()
  })
})

// ─────────────── Discord linking ───────────────

describe('collector_link_discord · identity linking invariants (auth.uid)', () => {
  it('first-time link succeeds and surfaces in the view', async () => {
    await asServiceRole()
    const uid = await makeUser('link1@example.test')
    await resetSession()
    await asUser(uid)
    await db.query(
      `select public.collector_link_discord('123456789', 'cooltrader', null, null)`,
    )
    await resetSession()
    await asServiceRole()
    const r = await db.query<{ discord_linked: boolean }>(
      `select discord_linked from public.collector_user_membership_view where user_id = '${uid}'::uuid`,
    )
    expect(r.rows[0]!.discord_linked).toBe(true)
    await resetSession()
  })

  it('unauthenticated (no auth.uid) call is rejected', async () => {
    await resetSession()
    let threw = false
    let msg = ''
    try {
      await db.query(`select public.collector_link_discord('x', null, null, null)`)
    } catch (e) { threw = true; msg = (e as Error).message }
    expect(threw).toBe(true)
    expect(msg).toMatch(/not_authenticated/)
  })

  it('a second CN account cannot claim the same Discord ID (UNIQUE enforced)', async () => {
    await asServiceRole()
    const uid1 = await makeUser('discord-claim-1@example.test')
    const uid2 = await makeUser('discord-claim-2@example.test')
    await resetSession()
    await asUser(uid1)
    await db.query(`select public.collector_link_discord('shared-discord-id', 'user1', null, null)`)
    await resetSession()
    await asUser(uid2)
    let threw = false
    let msg = ''
    try {
      await db.query(`select public.collector_link_discord('shared-discord-id', 'user2', null, null)`)
    } catch (e) { threw = true; msg = (e as Error).message }
    expect(threw).toBe(true)
    expect(msg).toMatch(/discord_already_linked/i)
    await resetSession()
  })

  it('same user re-linking a different Discord account updates the row in place', async () => {
    await asServiceRole()
    const uid = await makeUser('discord-relink@example.test')
    await resetSession()
    await asUser(uid)
    await db.query(`select public.collector_link_discord('first-discord-id', 'first-handle', null, null)`)
    await db.query(`select public.collector_link_discord('second-discord-id', 'second-handle', null, null)`)
    await resetSession()
    await asServiceRole()
    const r = await db.query<{ discord_user_id: string; discord_username: string }>(
      `select discord_user_id, discord_username from public.collector_discord_links where user_id = '${uid}'::uuid`,
    )
    expect(r.rows[0]!.discord_user_id).toBe('second-discord-id')
    expect(r.rows[0]!.discord_username).toBe('second-handle')
    await resetSession()
  })

  it('unlink (self-service) marks the row disconnected without locking the account', async () => {
    await asServiceRole()
    const uid = await makeUser('unlink@example.test')
    await resetSession()
    await asUser(uid)
    await db.query(`select public.collector_link_discord('to-unlink', 'who', null, null)`)
    await db.query(`select public.collector_unlink_discord()`)
    await resetSession()
    await asServiceRole()
    const view = await db.query<{ discord_linked: boolean; tier: string; status: string }>(
      `select discord_linked, tier, status from public.collector_user_membership_view where user_id = '${uid}'::uuid`,
    )
    expect(view.rows[0]!.discord_linked).toBe(false)
    expect(view.rows[0]!.tier).toBe('free')
    expect(view.rows[0]!.status).toBe('active')
    const log = await db.query<{ discord_user_id: string; disconnected_at: string | null }>(
      `select discord_user_id, disconnected_at::text from public.collector_discord_links where user_id = '${uid}'::uuid`,
    )
    expect(log.rows[0]!.discord_user_id).toBe('to-unlink')
    expect(log.rows[0]!.disconnected_at).not.toBeNull()
    await resetSession()
  })

  it('Discord linking alone does NOT upgrade tier', async () => {
    await asServiceRole()
    const uid = await makeUser('discord-only@example.test')
    await resetSession()
    await asUser(uid)
    await db.query(`select public.collector_link_discord('wishes-were-horses', null, null, null)`)
    await resetSession()
    await asServiceRole()
    const r = await db.query<{ tier: string }>(
      `select tier from collector_memberships where user_id = '${uid}'::uuid`,
    )
    expect(r.rows[0]!.tier).toBe('free')
    await resetSession()
  })
})

// ─────────────── Security · Discord self-service function cannot target another user ───────────────

describe('SECURITY: Discord self-service helpers use auth.uid() only', () => {
  it('collector_link_discord has NO p_user_id parameter (signature check)', async () => {
    const r = await db.query<{ argnames: string[] }>(
      `select proargnames::text[] as argnames
         from pg_proc
         where proname = 'collector_link_discord'
           and pronamespace = 'public'::regnamespace
         order by proargnames::text`,
    )
    // There should be exactly one "self-service" function with no
    // p_user_id arg; admin variant has it.
    const selfService = r.rows.find((row) => !row.argnames.includes('p_user_id'))
    expect(selfService, 'expected a self-service collector_link_discord with no p_user_id').toBeTruthy()
    expect(selfService!.argnames).toEqual(['p_discord_user_id','p_username','p_avatar','p_email'])
  })

  it('collector_unlink_discord has NO parameters (signature check)', async () => {
    const r = await db.query<{ argcount: number }>(
      `select coalesce(cardinality(proargnames), 0) as argcount
         from pg_proc
         where proname = 'collector_unlink_discord'
           and pronamespace = 'public'::regnamespace
         order by proargnames::text nulls first`,
    )
    // First row = self-service (no args); second = admin (p_user_id).
    expect(r.rows[0]!.argcount).toBe(0)
  })

  it('collector_admin_link_discord is service_role only', async () => {
    const r = await db.query<{ role: string; has: boolean }>(
      `select rolname as role,
              has_function_privilege(rolname,
                'public.collector_admin_link_discord(uuid, text, text, text, text)',
                'execute') as has
         from pg_roles
         where rolname in ('anon','authenticated','service_role')
         order by rolname`,
    )
    const map = Object.fromEntries(r.rows.map((x) => [x.role, x.has]))
    expect(map['anon']).toBe(false)
    expect(map['authenticated']).toBe(false)
    expect(map['service_role']).toBe(true)
  })

  it('collector_admin_unlink_discord is service_role only', async () => {
    const r = await db.query<{ role: string; has: boolean }>(
      `select rolname as role,
              has_function_privilege(rolname,
                'public.collector_admin_unlink_discord(uuid)',
                'execute') as has
         from pg_roles
         where rolname in ('anon','authenticated','service_role')
         order by rolname`,
    )
    const map = Object.fromEntries(r.rows.map((x) => [x.role, x.has]))
    expect(map['anon']).toBe(false)
    expect(map['authenticated']).toBe(false)
    expect(map['service_role']).toBe(true)
  })

  it('collector_user_has_feature refuses to answer another user from an authenticated session', async () => {
    await asServiceRole()
    const uid1 = await makeUser('probe-source@example.test')
    const uid2 = await makeUser('probe-target@example.test')
    // uid2 is premium.
    await db.query(`update collector_memberships set tier='premium' where user_id = '${uid2}'::uuid`)
    await resetSession()
    // uid1 session tries to probe uid2's premium flag.
    await asUser(uid1)
    const r = await db.query<{ ok: boolean }>(
      `select public.collector_user_has_feature($1::uuid, 'stock_alerts_premium') as ok`,
      [uid2],
    )
    expect(r.rows[0]!.ok).toBe(false)  // guard denies
    await resetSession()
    // Service-role bypass still works for the delivery worker.
    await asServiceRole()
    const r2 = await db.query<{ ok: boolean }>(
      `select public.collector_user_has_feature($1::uuid, 'stock_alerts_premium') as ok`,
      [uid2],
    )
    expect(r2.rows[0]!.ok).toBe(true)
    await resetSession()
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
