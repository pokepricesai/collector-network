import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import {
  planReconcileAction,
  runReconcile,
  type ReconcileTarget,
} from '../discord/reconcile'
import type { DiscordClient, DiscordResult } from '../discord/client'
import { createRealDiscordClient } from '../discord/client'

// CN-DISCORD-01 · PR #1 tests.
//
// Two layers:
//   1. Pure planReconcileAction() — no Postgres, covers the state
//      machine (free, premium, expired, suspended, no-binding,
//      disconnected).
//   2. runReconcile() end-to-end against a PGlite instance with
//      the CN-IDENTITY-01 + CN-DISCORD-01 migrations applied. A
//      mock DiscordClient captures intended API calls.
//
// A separate block covers the real HTTP client's 429 retry + 404
// / 403 error mapping using a fetch stub.
//
// Security invariants (anon/authenticated cannot read new tables)
// are enforced by the migration's `revoke all from public` + RLS.
// We prove the lockdown by a `has_table_privilege` probe.

// ────────────────────────────────────────────────────────
// Migration bootstrap
// ────────────────────────────────────────────────────────

const IDENTITY_SQL_1 = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations',
       '20261107070000_cn_identity_01_memberships_discord.sql'),
  'utf8',
)
const IDENTITY_SQL_2 = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations',
       '20261107080000_cn_identity_01_sec_fixes.sql'),
  'utf8',
)
const DISCORD_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations',
       '20261108000000_cn_discord_01_role_sync.sql'),
  'utf8',
)
const MIGRATION_SQL = IDENTITY_SQL_1 + '\n' + IDENTITY_SQL_2 + '\n' + DISCORD_SQL

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
create or replace function auth.uid() returns uuid
  language sql stable as $fn$
    select nullif(current_setting('test.auth_uid', true), '')::uuid
  $fn$;
`

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUB_SQL)
  await db.exec(MIGRATION_SQL)
}, 60_000)

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  // Clean every CN-DISCORD-01 + CN-IDENTITY-01 state between tests
  // so state doesn't leak between "free user" and "suspended user"
  // scenarios in the same file.
  await db.exec(`
    delete from public.collector_discord_role_sync_log;
    delete from public.collector_discord_role_bindings;
    delete from public.collector_discord_links;
    delete from public.collector_memberships;
    delete from auth.users;
    update public.collector_discord_guild_config
       set guild_id = null, role_sync_enabled = false, last_sync_at = null, last_sync_summary = null;
  `)
})

// ────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────

async function makeUser(email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id::text`,
    [email],
  )
  return r.rows[0]!.id
}

async function setMembership(
  userId: string,
  tier: 'free' | 'premium',
  status: 'active' | 'cancelled' | 'expired' | 'suspended',
  expiresAt: string | null = null,
): Promise<void> {
  await db.exec(
    `insert into public.collector_memberships (user_id, tier, status, expires_at, activated_at)
       values ('${userId}'::uuid, '${tier}', '${status}', ${expiresAt ? `'${expiresAt}'` : 'null'}, now())
     on conflict (user_id) do update
       set tier=excluded.tier, status=excluded.status, expires_at=excluded.expires_at`,
  )
}

async function linkDiscord(userId: string, discordUserId: string, disconnected: boolean = false): Promise<void> {
  await db.exec(
    `insert into public.collector_discord_links (user_id, discord_user_id, linked_at, disconnected_at)
       values ('${userId}'::uuid, '${discordUserId}', now(), ${disconnected ? 'now()' : 'null'})`,
  )
}

async function readTargets(): Promise<ReconcileTarget[]> {
  const r = await db.query<ReconcileTarget>(
    `select user_id::text as user_id, current_tier, current_status,
            current_expires_at, discord_user_id, discord_active, desired_tier
       from public.collector_discord_role_sync_targets`,
  )
  return r.rows
}

/** A minimal Supabase client that exposes the subset reconcile.ts
 *  needs (`.from('…').insert(…)`) and routes through PGlite. */
function makeSupabaseFacade(): {
  from: (table: string) => {
    insert: (row: unknown) => Promise<{ error: null | { message: string } }>
  }
} {
  return {
    from(table: string) {
      return {
        async insert(row: unknown): Promise<{ error: null | { message: string } }> {
          try {
            const r = row as Record<string, unknown>
            const cols = Object.keys(r)
            // Build a parameterised insert. Leaving explicit for the
            // test facade so there's no surprise about quoting.
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(',')
            const colList = cols.map((c) => `"${c}"`).join(',')
            const vals = cols.map((c) => {
              const v = r[c]
              if (Array.isArray(v)) return v
              return v ?? null
            })
            await db.query(
              `insert into public.${table} (${colList}) values (${placeholders})`,
              vals as unknown[],
            )
            return { error: null }
          } catch (e) {
            return { error: { message: (e as Error).message } }
          }
        },
      }
    },
  }
}

// Mock Discord client that records every call.
interface MockCall {
  method: 'getGuildMember' | 'addGuildMemberRole' | 'removeGuildMemberRole'
  guildId: string
  userId: string
  roleId?: string
}
function makeMockDiscord(
  options: {
    currentRoles?: Record<string, string[]>
    notInGuild?: Set<string>
    rateLimitOnFirst?: boolean
  } = {},
): { client: DiscordClient; calls: MockCall[] } {
  const calls: MockCall[] = []
  let rateLimitUsed = false
  const client: DiscordClient = {
    async getGuildMember(guildId, userId) {
      calls.push({ method: 'getGuildMember', guildId, userId })
      if (options.notInGuild?.has(userId)) {
        return { ok: false, code: 'not_in_guild', status: 404, detail: 'not in guild' }
      }
      if (options.rateLimitOnFirst && !rateLimitUsed) {
        rateLimitUsed = true
        return { ok: false, code: 'rate_limited', status: 429, detail: 'burst' }
      }
      return { ok: true, value: { user_id: userId, role_ids: options.currentRoles?.[userId] ?? [] } }
    },
    async addGuildMemberRole(guildId, userId, roleId) {
      calls.push({ method: 'addGuildMemberRole', guildId, userId, roleId })
      return { ok: true, value: null }
    },
    async removeGuildMemberRole(guildId, userId, roleId) {
      calls.push({ method: 'removeGuildMemberRole', guildId, userId, roleId })
      return { ok: true, value: null }
    },
  }
  return { client, calls }
}

// ────────────────────────────────────────────────────────
// 1. Schema is additive and locked down
// ────────────────────────────────────────────────────────

describe('migration · schema + lockdown', () => {
  it('creates the three CN-DISCORD-01 tables + the reconcile view', async () => {
    const tables = await db.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname='public'
          and tablename like 'collector_discord_%'
        order by tablename`,
    )
    const names = tables.rows.map((r) => r.tablename)
    expect(names).toContain('collector_discord_role_bindings')
    expect(names).toContain('collector_discord_role_sync_log')
    expect(names).toContain('collector_discord_guild_config')
    // Not a view regression — it stays a view.
    const view = await db.query<{ relname: string }>(
      `select relname from pg_class
        where relname='collector_discord_role_sync_targets' and relkind='v'`,
    )
    expect(view.rows.length).toBe(1)
  })

  it('seeds a singleton guild_config row with role_sync_enabled=false', async () => {
    const r = await db.query<{ role_sync_enabled: boolean; guild_id: string | null }>(
      `select role_sync_enabled, guild_id from collector_discord_guild_config where id=1`,
    )
    expect(r.rows.length).toBe(1)
    expect(r.rows[0]!.role_sync_enabled).toBe(false)
  })

  it('denies anon + authenticated any SELECT on the three new tables', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const table of [
        'collector_discord_role_bindings',
        'collector_discord_role_sync_log',
        'collector_discord_guild_config',
      ]) {
        const r = await db.query<{ ok: boolean }>(
          `select has_table_privilege('${role}', 'public.${table}', 'SELECT') as ok`,
        )
        expect(
          r.rows[0]!.ok,
          `role ${role} must NOT have SELECT on ${table}`,
        ).toBe(false)
      }
    }
  })

  it('grants service_role write access on bindings + log', async () => {
    const r = await db.query<{ ok: boolean }>(
      `select has_table_privilege('service_role','public.collector_discord_role_bindings','INSERT') as ok`,
    )
    expect(r.rows[0]!.ok).toBe(true)
    const r2 = await db.query<{ ok: boolean }>(
      `select has_table_privilege('service_role','public.collector_discord_role_sync_log','INSERT') as ok`,
    )
    expect(r2.rows[0]!.ok).toBe(true)
  })

  it('does not touch cn_stock_* tables (CN-STOCK-02 pilot isolation)', async () => {
    // Just assert the new tables don't start with cn_stock_. We're
    // not stubbing the stock schema in these tests, so a negative
    // check against its name suffix is enough proof of non-overlap.
    const r = await db.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname='public' and tablename like 'cn_stock_%'`,
    )
    expect(r.rows).toEqual([])
  })
})

// ────────────────────────────────────────────────────────
// 2. Reconciliation view computes desired_tier correctly
// ────────────────────────────────────────────────────────

describe('view · desired_tier', () => {
  it('free + active → desired=free', async () => {
    const u = await makeUser('free@test.io')
    await setMembership(u, 'free', 'active')
    await linkDiscord(u, 'd_1')
    const targets = await readTargets()
    const t = targets[0]!
    expect(t.desired_tier).toBe('free')
    expect(t.discord_active).toBe(true)
  })

  it('premium + active + future expiry → desired=premium', async () => {
    const u = await makeUser('prem@test.io')
    await setMembership(u, 'premium', 'active', new Date(Date.now() + 86_400_000).toISOString())
    await linkDiscord(u, 'd_2')
    const targets = await readTargets()
    const t = targets[0]!
    expect(t.desired_tier).toBe('premium')
  })

  it('premium + active + PAST expiry → desired degrades to free', async () => {
    const u = await makeUser('expired@test.io')
    await setMembership(u, 'premium', 'active', new Date(Date.now() - 86_400_000).toISOString())
    await linkDiscord(u, 'd_3')
    const targets = await readTargets()
    const t = targets[0]!
    expect(t.desired_tier).toBe('free')
  })

  it('suspended membership → desired=null', async () => {
    const u = await makeUser('suspended@test.io')
    await setMembership(u, 'premium', 'suspended')
    await linkDiscord(u, 'd_4')
    const targets = await readTargets()
    const t = targets[0]!
    expect(t.desired_tier).toBeNull()
  })

  it('discord disconnected → discord_active=false, discord_user_id=null', async () => {
    const u = await makeUser('dc@test.io')
    await setMembership(u, 'free', 'active')
    await linkDiscord(u, 'd_5', true)
    const targets = await readTargets()
    const t = targets[0]!
    expect(t.discord_active).toBe(false)
    expect(t.discord_user_id).toBeNull()
  })
})

// ────────────────────────────────────────────────────────
// 3. planReconcileAction state machine (pure)
// ────────────────────────────────────────────────────────

describe('planReconcileAction', () => {
  const bindings = { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' }

  function tgt(overrides: Partial<ReconcileTarget>): ReconcileTarget {
    return {
      user_id: 'u1',
      current_tier: 'free',
      current_status: 'active',
      current_expires_at: null,
      discord_user_id: 'd1',
      discord_active: true,
      desired_tier: 'free',
      ...overrides,
    }
  }

  it('free active → add free role, remove premium role', () => {
    const plan = planReconcileAction(tgt({ desired_tier: 'free' }), bindings)
    expect(plan.actions).toEqual([
      { kind: 'add_role', roleId: 'ROLE_FREE' },
      { kind: 'remove_role', roleId: 'ROLE_PREMIUM' },
    ])
  })

  it('premium active → add premium, remove free', () => {
    const plan = planReconcileAction(tgt({ desired_tier: 'premium', current_tier: 'premium' }), bindings)
    expect(plan.actions).toEqual([
      { kind: 'add_role', roleId: 'ROLE_PREMIUM' },
      { kind: 'remove_role', roleId: 'ROLE_FREE' },
    ])
  })

  it('suspended (desired=null) → skip_suspended + remove both roles', () => {
    const plan = planReconcileAction(tgt({ desired_tier: null, current_status: 'suspended' }), bindings)
    expect(plan.actions[0]).toEqual({ kind: 'skip_suspended' })
    const kinds = plan.actions.map((a) => a.kind).sort()
    expect(kinds).toContain('remove_role')
  })

  it('discord disconnected → single skip_disconnected', () => {
    const plan = planReconcileAction(tgt({ discord_active: false, discord_user_id: null }), bindings)
    expect(plan.actions).toEqual([{ kind: 'skip_disconnected' }])
  })

  it('missing binding → skip_no_binding, no API calls', () => {
    const plan = planReconcileAction(tgt({ desired_tier: 'premium' }), { free: 'ROLE_FREE' })
    expect(plan.actions).toEqual([{ kind: 'skip_no_binding', missingTier: 'premium' }])
  })
})

// ────────────────────────────────────────────────────────
// 4. runReconcile end-to-end: dry-run path
// ────────────────────────────────────────────────────────

describe('runReconcile · dry-run', () => {
  it('never calls the Discord client in dry-run mode', async () => {
    const u = await makeUser('live@test.io')
    await setMembership(u, 'premium', 'active', new Date(Date.now() + 86_400_000).toISOString())
    await linkDiscord(u, 'D_PREMIUM')
    const targets = await readTargets()
    const { client, calls } = makeMockDiscord()
    const summary = await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' },
        runId: randomUUID(),
        dryRun: true,
      },
      targets,
    )
    expect(calls).toEqual([])
    expect(summary.add_role).toBe(1)
    expect(summary.remove_role).toBe(1)
    expect(summary.dry_run_rows).toBe(2)
  })

  it('writes dry_run rows to the audit log with intended desired_role_id', async () => {
    const u = await makeUser('log@test.io')
    await setMembership(u, 'free', 'active')
    await linkDiscord(u, 'D_LOG')
    const targets = await readTargets()
    const runId = randomUUID()
    await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: makeMockDiscord().client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' },
        runId,
        dryRun: true,
      },
      targets,
    )
    const rows = await db.query<{ action: string; result: string; desired_role_id: string | null; desired_tier: string | null }>(
      `select action, result, desired_role_id, desired_tier
         from collector_discord_role_sync_log
        where run_id='${runId}' order by id`,
    )
    expect(rows.rows.map((r) => r.action)).toEqual(['add_role', 'remove_role'])
    expect(rows.rows.every((r) => r.result === 'dry_run')).toBe(true)
    expect(rows.rows[0]!.desired_role_id).toBe('ROLE_FREE')
    expect(rows.rows[1]!.desired_role_id).toBe('ROLE_PREMIUM')
  })

  it('logs skip_disconnected for a user with no active discord link', async () => {
    const u = await makeUser('nodc@test.io')
    await setMembership(u, 'free', 'active')
    const targets = await readTargets()
    const runId = randomUUID()
    const summary = await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: makeMockDiscord().client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' },
        runId,
        dryRun: true,
      },
      targets,
    )
    expect(summary.skip_disconnected).toBe(1)
    const r = await db.query<{ action: string }>(
      `select action from collector_discord_role_sync_log where run_id='${runId}'`,
    )
    expect(r.rows.map((x) => x.action)).toEqual(['skip_disconnected'])
  })

  it('logs skip_no_binding when the tier mapping is missing', async () => {
    const u = await makeUser('nobind@test.io')
    await setMembership(u, 'premium', 'active', new Date(Date.now() + 86_400_000).toISOString())
    await linkDiscord(u, 'D_NB')
    const targets = await readTargets()
    const runId = randomUUID()
    const summary = await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: makeMockDiscord().client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE' }, // intentionally missing 'premium'
        runId,
        dryRun: true,
      },
      targets,
    )
    expect(summary.skip_no_binding).toBe(1)
    const r = await db.query<{ action: string }>(
      `select action from collector_discord_role_sync_log where run_id='${runId}'`,
    )
    expect(r.rows[0]!.action).toBe('skip_no_binding')
  })
})

// ────────────────────────────────────────────────────────
// 5. runReconcile end-to-end: live mode
// ────────────────────────────────────────────────────────

describe('runReconcile · live mode', () => {
  it('suppresses add_role when the user already has the desired role', async () => {
    const u = await makeUser('idempotent@test.io')
    await setMembership(u, 'premium', 'active', new Date(Date.now() + 86_400_000).toISOString())
    await linkDiscord(u, 'D_IDEM')
    const targets = await readTargets()
    const { client, calls } = makeMockDiscord({ currentRoles: { D_IDEM: ['ROLE_PREMIUM'] } })
    const runId = randomUUID()
    const summary = await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' },
        runId,
        dryRun: false,
      },
      targets,
    )
    // One GET + zero PUT + zero DELETE (both intended writes become noops).
    expect(calls.filter((c) => c.method === 'getGuildMember').length).toBe(1)
    expect(calls.filter((c) => c.method === 'addGuildMemberRole').length).toBe(0)
    expect(calls.filter((c) => c.method === 'removeGuildMemberRole').length).toBe(0)
    expect(summary.noop).toBe(2)
  })

  it('member not in guild → skip_not_in_guild, no PUT/DELETE', async () => {
    const u = await makeUser('out@test.io')
    await setMembership(u, 'premium', 'active', new Date(Date.now() + 86_400_000).toISOString())
    await linkDiscord(u, 'D_OUT')
    const targets = await readTargets()
    const { client, calls } = makeMockDiscord({ notInGuild: new Set(['D_OUT']) })
    const runId = randomUUID()
    const summary = await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' },
        runId,
        dryRun: false,
      },
      targets,
    )
    expect(summary.skip_not_in_guild).toBe(1)
    expect(calls.some((c) => c.method !== 'getGuildMember')).toBe(false)
  })

  it('premium expired → add free, remove premium on a user who had premium', async () => {
    const u = await makeUser('exp@test.io')
    await setMembership(u, 'premium', 'active', new Date(Date.now() - 86_400_000).toISOString())
    await linkDiscord(u, 'D_EXP')
    const targets = await readTargets()
    const { client, calls } = makeMockDiscord({ currentRoles: { D_EXP: ['ROLE_PREMIUM'] } })
    const runId = randomUUID()
    await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' },
        runId,
        dryRun: false,
      },
      targets,
    )
    const adds = calls.filter((c) => c.method === 'addGuildMemberRole').map((c) => c.roleId)
    const removes = calls.filter((c) => c.method === 'removeGuildMemberRole').map((c) => c.roleId)
    expect(adds).toEqual(['ROLE_FREE'])
    expect(removes).toEqual(['ROLE_PREMIUM'])
  })

  it('suspended user with premium role attached → remove both tier roles', async () => {
    const u = await makeUser('susp@test.io')
    await setMembership(u, 'premium', 'suspended')
    await linkDiscord(u, 'D_SUS')
    const targets = await readTargets()
    const { client, calls } = makeMockDiscord({ currentRoles: { D_SUS: ['ROLE_PREMIUM', 'ROLE_FREE'] } })
    const runId = randomUUID()
    const summary = await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' },
        runId,
        dryRun: false,
      },
      targets,
    )
    const removes = calls.filter((c) => c.method === 'removeGuildMemberRole').map((c) => c.roleId).sort()
    expect(removes).toEqual(['ROLE_FREE', 'ROLE_PREMIUM'])
    expect(summary.skip_suspended).toBe(1)
  })

  it('respects apiCallBudget and stops when the budget is consumed', async () => {
    for (let i = 0; i < 5; i++) {
      const u = await makeUser(`b${i}@test.io`)
      await setMembership(u, 'free', 'active')
      await linkDiscord(u, `D_B${i}`)
    }
    const targets = await readTargets()
    const { client, calls } = makeMockDiscord()
    const summary = await runReconcile(
      {
        supabase: makeSupabaseFacade() as never,
        discord: client,
        guildId: 'G1',
        bindings: { free: 'ROLE_FREE', premium: 'ROLE_PREMIUM' },
        runId: randomUUID(),
        dryRun: false,
        apiCallBudget: 3, // only enough for 1 GET + 2 writes
      },
      targets,
    )
    expect(calls.length).toBeLessThanOrEqual(3)
    expect(summary.budget_remaining).toBe(0)
  })
})

// ────────────────────────────────────────────────────────
// 6. Real HTTP client · 429 retry + 404 / 403 mapping
// ────────────────────────────────────────────────────────

describe('createRealDiscordClient', () => {
  function makeFetch(responses: Array<Partial<Response> & { statusText?: string; _body?: string; _retryAfter?: string }>) {
    let i = 0
    return (async (_url: string, _init?: RequestInit): Promise<Response> => {
      const r = responses[i++]!
      const headers = new Headers()
      if (r._retryAfter) headers.set('retry-after', r._retryAfter)
      return {
        status: r.status ?? 200,
        statusText: r.statusText ?? '',
        headers,
        async text() { return r._body ?? '' },
        async json() { return r._body ? JSON.parse(r._body) : {} },
      } as unknown as Response
    }) as unknown as typeof fetch
  }

  it('retries once after a 429 with a short Retry-After then succeeds', async () => {
    const client = createRealDiscordClient({
      token: 'TOKEN',
      fetchImpl: makeFetch([
        { status: 429, _retryAfter: '0' },
        { status: 200, _body: JSON.stringify({ user: { id: 'U1' }, roles: ['R1'] }) },
      ]),
      maxRetryAfterMs: 50,
    })
    const r: DiscordResult<unknown> = await client.getGuildMember('G', 'U1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({ user_id: 'U1', role_ids: ['R1'] })
    }
  })

  it('second consecutive 429 surfaces as error_429', async () => {
    const client = createRealDiscordClient({
      token: 'TOKEN',
      fetchImpl: makeFetch([
        { status: 429, _retryAfter: '0' },
        { status: 429, _retryAfter: '0' },
      ]),
      maxRetryAfterMs: 20,
    })
    const r = await client.getGuildMember('G', 'U1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('rate_limited')
  })

  it('maps 404 to not_in_guild', async () => {
    const client = createRealDiscordClient({
      token: 'TOKEN',
      fetchImpl: makeFetch([{ status: 404, _body: '{"message":"not found"}' }]),
    })
    const r = await client.getGuildMember('G', 'U_MISSING')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('not_in_guild')
  })

  it('maps 403 to forbidden', async () => {
    const client = createRealDiscordClient({
      token: 'TOKEN',
      fetchImpl: makeFetch([{ status: 403, _body: '{"message":"missing perms"}' }]),
    })
    const r = await client.addGuildMemberRole('G', 'U1', 'R1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('forbidden')
  })

  it('caps Retry-After honoring to maxRetryAfterMs', async () => {
    // A 100-second Retry-After must still return in ~50ms when
    // capped. We only assert it returns; if the cap were ignored
    // the test would time out.
    const client = createRealDiscordClient({
      token: 'TOKEN',
      fetchImpl: makeFetch([
        { status: 429, _retryAfter: '100' },
        { status: 200, _body: JSON.stringify({ user: { id: 'U' }, roles: [] }) },
      ]),
      maxRetryAfterMs: 20,
    })
    const started = Date.now()
    const r = await client.getGuildMember('G', 'U')
    expect(Date.now() - started).toBeLessThan(500)
    expect(r.ok).toBe(true)
  })
})
