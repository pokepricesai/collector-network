import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// CN-06.06 corrections · SQL-contract tests for the review-gate
// migration. Companion ingester-state-machine tests live on the
// PR #6 branch (apps/hub/src/server/releases/__tests__/ingester-
// gate.test.ts) because the ingester code is only present there.
//
// This file assert the SQL file's filter clauses + column
// projections + grants + CHECK constraints are exactly what the
// brief requires. Any drift — someone deleting the
// `review_status='approved'` filter from the public view, for
// example — fails these tests immediately.

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261107010000_releases_review_gate.sql'),
  'utf8',
)

const BASE_VIEW_MIGRATION_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261107000000_releases_public_view.sql'),
  'utf8',
)

describe('migration 20261107010000 — review-gate schema', () => {
  it('adds review_status column with pending_review default', () => {
    expect(MIGRATION_SQL).toMatch(/add column if not exists review_status text not null default 'pending_review'/i)
  })

  it('constrains review_status to the three documented values', () => {
    expect(MIGRATION_SQL).toMatch(/check \(review_status in \('pending_review','approved','rejected'\)\)/i)
  })

  it('adds proposed_release_date, _precision, _at, _source columns', () => {
    expect(MIGRATION_SQL).toMatch(/add column if not exists proposed_release_date\s+date/i)
    expect(MIGRATION_SQL).toMatch(/add column if not exists proposed_release_date_precision text/i)
    expect(MIGRATION_SQL).toMatch(/add column if not exists proposed_change_at\s+timestamptz/i)
    expect(MIGRATION_SQL).toMatch(/add column if not exists proposed_change_source\s+text/i)
  })

  it('adds parent_release_id self-reference with SET NULL on delete', () => {
    expect(MIGRATION_SQL).toMatch(/parent_release_id uuid[\s\S]*?references public\.network_tcg_releases \(id\) on delete set null/i)
  })

  it('blocks self-parenting via CHECK constraint', () => {
    expect(MIGRATION_SQL).toMatch(/parent_release_id is null or parent_release_id <> id/i)
  })

  it('extends change-log change_type enum with date_proposed / date_accepted / date_rejected / review_status_changed', () => {
    for (const t of ['date_proposed', 'date_accepted', 'date_rejected', 'review_status_changed']) {
      expect(MIGRATION_SQL).toContain(`'${t}'`)
    }
  })
})

describe('migration 20261107010000 — public view hardening', () => {
  it('drops and recreates the view (supersedes the less-strict base migration)', () => {
    expect(MIGRATION_SQL).toMatch(/drop view if exists public\.network_tcg_releases_public/i)
  })

  it('filters on review_status=approved AND parent_release_id IS NULL AND public-safe confirmation_status', () => {
    expect(MIGRATION_SQL).toMatch(/review_status = 'approved'/i)
    expect(MIGRATION_SQL).toMatch(/parent_release_id is null/i)
    expect(MIGRATION_SQL).toMatch(
      /confirmation_status in \('confirmed', 'announced_tbc', 'postponed', 'released'\)/i,
    )
  })

  it('runs as owner, not invoker, with security_barrier', () => {
    expect(MIGRATION_SQL).toMatch(/security_invoker = false/i)
    expect(MIGRATION_SQL).toMatch(/security_barrier = true/i)
  })

  it('does NOT project operator-only columns', () => {
    const m = MIGRATION_SQL.match(/create view public\.network_tcg_releases_public[\s\S]*?from public\.network_tcg_releases/i)
    expect(m).toBeTruthy()
    const selectClause = m![0].toLowerCase()
    for (const col of [
      'source_notes',
      'source_verified_at',
      'verification_mode',
      'review_status',           // the gate itself must not be public
      'metadata',
      'created_by',
      'updated_by',
      'created_at',
      'proposed_release_date',   // internal only
      'proposed_change_at',
      'proposed_change_source',
    ]) {
      expect(selectClause).not.toContain(col)
    }
  })

  it('REVOKE ALL precedes GRANT SELECT to anon + authenticated', () => {
    expect(MIGRATION_SQL).toMatch(/revoke all on public\.network_tcg_releases_public from public/i)
    expect(MIGRATION_SQL).toMatch(/grant select on public\.network_tcg_releases_public to anon, authenticated/i)
    const revokeIdx = MIGRATION_SQL.toLowerCase().indexOf('revoke all on public.network_tcg_releases_public')
    const grantIdx = MIGRATION_SQL.toLowerCase().indexOf('grant select on public.network_tcg_releases_public')
    expect(revokeIdx).toBeGreaterThanOrEqual(0)
    expect(grantIdx).toBeGreaterThan(revokeIdx)
  })

  it('subproducts view also runs as owner with security_barrier + is granted to anon', () => {
    expect(MIGRATION_SQL).toMatch(/create view public\.network_tcg_releases_subproducts[\s\S]*?security_invoker = false[\s\S]*?security_barrier = true/i)
    expect(MIGRATION_SQL).toMatch(/grant select on public\.network_tcg_releases_subproducts to anon, authenticated/i)
  })

  it('base migration 20261107000000 also uses security_invoker = false (defence in depth)', () => {
    expect(BASE_VIEW_MIGRATION_SQL).toMatch(/security_invoker = false/i)
  })
})
