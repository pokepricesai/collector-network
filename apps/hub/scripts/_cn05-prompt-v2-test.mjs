#!/usr/bin/env node
// CN-05 OS — v2 prompt builder regression tests.
//
// Exercises buildClaudePrompt against five representative fixtures
// using Node 24's --experimental-strip-types to import the actual
// deployed TS modules. The assertions inspect the actual generated
// prompt TEXT, not just helper functions, so a template drift fails
// the test.
//
// Run:
//   node --experimental-strip-types apps/hub/scripts/_cn05-prompt-v2-test.mjs

import '../../../scripts/_lib/load-env.mjs'
import { buildClaudePrompt, PROMPT_VERSION } from '../src/server/claude/action-prompt.ts'
import { parseAndValidateReceipt } from '../src/server/claude/completion-receipt.ts'
import { assessRelevance } from '../src/server/claude/relevance.ts'

const results = []
function pass(n, note = '') { results.push({ ok: true, n }); console.log(`  ✓ ${n}${note ? ' — ' + note : ''}`) }
function fail(n, err) { results.push({ ok: false, n, err: err?.message ?? String(err) }); console.log(`  ✗ ${n} — ${err?.message ?? err}`) }
function section(name) { console.log(`\n━━━ ${name} ━━━`) }
function assertContains(label, text, needle, invert = false) {
  const has = text.includes(needle)
  if (has !== invert) pass(`${label}: contains "${needle.slice(0, 60)}${needle.length > 60 ? '…' : ''}"`)
  else fail(`${label}: expected ${invert ? 'absence' : 'presence'} of "${needle.slice(0, 80)}"`, new Error('not found'))
}
function assertRegex(label, text, regex) {
  if (regex.test(text)) pass(`${label}: matches ${regex}`)
  else fail(`${label}: does not match ${regex}`, new Error('no match'))
}

// Fixed clock so date-sensitive assertions are deterministic. We
// pick November 2026 so Test A's "oct-2026" event is cleanly in the
// past at the month-year granularity our URL date parser uses.
const now = new Date('2026-11-05T00:00:00Z')

// ─────────────────────── Fixtures ───────────────────────
function fixtureNewmarket() {
  // Expired Newmarket card show (Oct 2026).
  return {
    task: {
      id: 'test-newmarket', title: 'Striking distance · newmarket card show oct 2026',
      description: 'Low-CTR striking-distance opportunity.',
      priority: 'low', status: 'open', site_id: 'pokemon-site',
      task_type: 'intelligence', task_kind: 'improvement', task_source: 'intelligence',
      evidence: { intelligence_item_id: 'test-newmarket-intel' },
      metadata: {},
      recommended_action: 'Rewrite title + meta description to match the top-ranked query intent.',
      created_at: now.toISOString(),
    },
    site: { slug: 'pokemon', name: 'PokePrices', domain: 'pokeprices.io' },
    intel: {
      id: 'test-newmarket-intel', category: 'seo', type: 'striking-distance', signal_kind: 'opportunity',
      title: 'Striking distance · pokemon · pos 10.5',
      summary: '3 queries, 420 impressions at weighted position 10.5, CTR 0.00%. Top query: "newmarket card show oct 2026".',
      recommended_action: 'Rewrite title + meta description to match the top-ranked query intent.',
      evidence: {
        page: 'https://www.pokeprices.io/events/newmarket-card-show-oct-2026',
        top_queries: [
          { query: 'newmarket card show oct 2026', impressions: 310, clicks: 0, position: 10.4 },
          { query: 'pokemon show newmarket', impressions: 70, clicks: 0, position: 10.9 },
        ],
      },
      expected_upside: null,
      impact_score: 40, confidence_score: 55, urgency_score: 30, effort_score: 35, priority_score: 42,
      first_detected_at: '2026-10-15T00:00:00Z', last_detected_at: '2026-10-28T00:00:00Z',
    },
    baseline: null,
    target_evidence: {
      target_url: 'https://www.pokeprices.io/events/newmarket-card-show-oct-2026',
      target_query: 'newmarket card show oct 2026',
      window: { start: '2026-09-29', end: '2026-10-26' },
      url_level: { impressions_28d: 420, clicks_28d: 0, ctr_28d: 0, avg_position_28d: 10.5, days_with_data: 20 },
      query_level: { impressions_28d: 310, clicks_28d: 0, ctr_28d: 0, avg_position_28d: 10.4, days_with_data: 18 },
      top_queries_for_url: null,
      notes: [],
    },
    now,
  }
}

function fixtureCharizard() {
  // The real production item 099d374a / target 83206ad1 shape.
  return {
    task: {
      id: '83206ad1-c713-455d-9db8-66e91e298867',
      title: 'Striking distance · pokemon · pos 9.3 · 14 queries',
      description: '14 queries, 1.9k combined impressions at weighted position 9.3, CTR 0.00%. Top query: "first edition charizard psa 10".',
      priority: 'normal', status: 'open', site_id: 'pokemon-site',
      task_type: 'intelligence', task_kind: 'improvement', task_source: 'intelligence',
      evidence: { intelligence_item_id: '099d374a-87d4-4d74-a67e-19d62170ba9a' },
      metadata: {},
      recommended_action: 'Rewrite title + meta description to match the top-ranked query intent, strengthen top-of-page content.',
      created_at: now.toISOString(),
    },
    site: { slug: 'pokemon', name: 'PokePrices', domain: 'pokeprices.io' },
    intel: {
      id: '099d374a-87d4-4d74-a67e-19d62170ba9a', category: 'seo', type: 'striking-distance', signal_kind: 'opportunity',
      title: 'Striking distance · pokemon · pos 9.3 · 14 queries',
      summary: '14 queries, 1.9k combined impressions at weighted position 9.3, CTR 0.00%. Top query: "first edition charizard psa 10".',
      recommended_action: 'Rewrite title + meta description to match the top-ranked query intent, strengthen top-of-page content.',
      evidence: {
        page: 'https://www.pokeprices.io/set/Base%20Set/card/charizard-1st-edition-4',
        ctr: 0,
        query_count: 14,
        top_queries: [
          { query: 'first edition charizard psa 10', impressions: 342, clicks: 0, position: 10.6 },
          { query: '1st edition charizard psa 10', impressions: 310, clicks: 0, position: 9.44 },
          { query: '1st edition charizard price', impressions: 240, clicks: 0, position: 9.0 },
        ],
        total_impressions_28d: 1901,
        total_clicks_28d: 0,
        weighted_position: 9.31,
      },
      expected_upside: { gsc_clicks_28d_delta: 10, note: 'scenario if CTR reaches 2%' },
      impact_score: 60, confidence_score: 70, urgency_score: 40, effort_score: 30, priority_score: 57,
      first_detected_at: '2026-10-20T09:10:47Z', last_detected_at: '2026-11-04T06:30:05Z',
    },
    baseline: {
      frozen_at: '2026-11-04T12:00:00Z', frozen_version: 'cn05-baseline-v1',
      window_start: '2026-10-07', window_end: '2026-11-03',
      target_url: 'https://www.pokeprices.io/set/Base%20Set/card/charizard-1st-edition-4',
      target_query: 'first edition charizard psa 10',
      gsc_clicks_28d: 3732, gsc_impressions_28d: 469318,
      gsc_avg_position_28d: 15.2, gsc_avg_ctr_28d: 0.00795,
      ga4_active_users_28d: 15214, ga4_sessions_28d: 25000,
    },
    target_evidence: {
      target_url: 'https://www.pokeprices.io/set/Base%20Set/card/charizard-1st-edition-4',
      target_query: 'first edition charizard psa 10',
      window: { start: '2026-09-30', end: '2026-10-27' },
      url_level: { impressions_28d: 1901, clicks_28d: 0, ctr_28d: 0, avg_position_28d: 9.31, days_with_data: 28 },
      query_level: { impressions_28d: 342, clicks_28d: 0, ctr_28d: 0, avg_position_28d: 10.6, days_with_data: 25 },
      top_queries_for_url: [
        { query: 'first edition charizard psa 10', impressions: 342, clicks: 0, avg_position: 10.6 },
        { query: '1st edition charizard psa 10', impressions: 310, clicks: 0, avg_position: 9.44 },
        { query: '1st edition charizard price', impressions: 240, clicks: 0, avg_position: 9.0 },
      ],
      notes: [],
    },
    now,
  }
}

function fixtureSiteWide() {
  // Site-wide technical issue (no target URL).
  return {
    task: {
      id: 'test-sitewide', title: 'Latency spike on YGO function regions',
      description: 'Site-wide function latency climbed 1.6× over last 7 days.',
      priority: 'high', status: 'open', site_id: 'ygo-site',
      task_type: 'technical', task_kind: 'fix', task_source: 'intelligence',
      evidence: { intelligence_item_id: 'test-sitewide-intel' },
      metadata: {},
      recommended_action: 'Investigate function latency root cause; propose a fix with regression scope.',
      created_at: now.toISOString(),
    },
    site: { slug: 'ygo', name: 'YGOPrices', domain: 'ygoprices.io' },
    intel: {
      id: 'test-sitewide-intel', category: 'technical', type: 'latency-regression', signal_kind: 'warning',
      title: 'YGO function latency regression', summary: 'p95 latency +60% vs baseline, network-wide pattern.',
      recommended_action: 'Investigate function latency root cause; propose a fix with regression scope.',
      evidence: { affected_scope: 'site_wide', deploy_window: '2026-10-20..2026-10-27' },
      expected_upside: null,
      impact_score: 80, confidence_score: 75, urgency_score: 85, effort_score: 60, priority_score: 76,
      first_detected_at: '2026-10-28T00:00:00Z', last_detected_at: '2026-10-28T06:30:00Z',
    },
    baseline: null, target_evidence: null, now,
  }
}

function fixtureInsufficient() {
  // Thin signal — only 40 impressions.
  return {
    task: {
      id: 'test-thin', title: 'Striking distance · thin signal',
      description: 'Low-impression opportunity.', priority: 'low', status: 'open', site_id: 'pokemon-site',
      task_type: 'intelligence', task_kind: 'improvement', task_source: 'intelligence',
      evidence: { intelligence_item_id: 'test-thin-intel' }, metadata: {},
      recommended_action: 'Consider metadata tweak.', created_at: now.toISOString(),
    },
    site: { slug: 'pokemon', name: 'PokePrices', domain: 'pokeprices.io' },
    intel: {
      id: 'test-thin-intel', category: 'seo', type: 'striking-distance', signal_kind: 'opportunity',
      title: 'Striking distance · pokemon · pos 11.0 · 1 query', summary: '1 query, 40 impressions.',
      recommended_action: 'Consider metadata tweak.',
      evidence: {
        page: 'https://www.pokeprices.io/pokemon/jirachi',
        top_queries: [{ query: 'jirachi card price', impressions: 40, clicks: 0, position: 11.0 }],
        total_impressions_28d: 40, total_clicks_28d: 0,
      },
      expected_upside: null,
      impact_score: 20, confidence_score: 40, urgency_score: 20, effort_score: 50, priority_score: 30,
      first_detected_at: '2026-10-20T00:00:00Z', last_detected_at: '2026-10-28T00:00:00Z',
    },
    baseline: null, target_evidence: null, now,
  }
}

function fixtureHighRisk() {
  // Site-wide canonical fix — high risk, should require approval.
  return {
    task: {
      id: 'test-highrisk', title: 'Canonical mismatch across 20k card pages',
      description: 'Canonical URL inconsistent with sitemap on all card pages.',
      priority: 'critical', status: 'open', site_id: 'pokemon-site',
      task_type: 'intelligence', task_kind: 'fix', task_source: 'intelligence',
      evidence: { intelligence_item_id: 'test-highrisk-intel' }, metadata: {},
      recommended_action: 'Correct canonical generation to match sitemap entries.',
      created_at: now.toISOString(),
    },
    site: { slug: 'pokemon', name: 'PokePrices', domain: 'pokeprices.io' },
    intel: {
      id: 'test-highrisk-intel', category: 'technical', type: 'canonical-mismatch', signal_kind: 'warning',
      title: 'Canonical mismatch · pokemon · ~20k pages',
      summary: '20,000 card pages have canonical pointing to non-sitemap URL variants.',
      recommended_action: 'Correct canonical generation to match sitemap entries.',
      evidence: { affected_pages: 20000, affected_scope: 'site_wide' },
      expected_upside: { gsc_impressions_28d_delta_pct: 15 },
      impact_score: 85, confidence_score: 80, urgency_score: 70, effort_score: 50, priority_score: 76,
      first_detected_at: '2026-10-20T00:00:00Z', last_detected_at: '2026-10-28T00:00:00Z',
    },
    baseline: null, target_evidence: null, now,
  }
}

// ─────────────────────── Tests ───────────────────────
function main() {
  section('Preamble — prompt builder version')
  if (PROMPT_VERSION === 'cn05-action-prompt-v2') pass('PROMPT_VERSION = cn05-action-prompt-v2')
  else fail('PROMPT_VERSION bumped', new Error(PROMPT_VERSION))

  section('A. Expired Newmarket card show — must flag stale date + permit NO CHANGE')
  const a = buildClaudePrompt(fixtureNewmarket())
  assertContains('A', a.prompt_text, '## OS relevance assessment')
  assertContains('A', a.prompt_text, 'potentially_stale')
  assertRegex('A', a.prompt_text, /Event date detected:\s+\*\*2026-10\*\*/)
  assertRegex('A', a.prompt_text, /in the past/i)
  assertContains('A', a.prompt_text, 'NO_CHANGE')
  assertContains('A', a.prompt_text, 'Stage A — Investigate')
  assertContains('A', a.prompt_text, 'Stage B — Decide')
  if (a.relevance.verdict === 'potentially_stale') pass('relevance.verdict = potentially_stale')
  else fail('verdict', new Error(a.relevance.verdict))
  if (a.relevance.opportunity_type === 'striking_distance_seo') pass('opportunity_type = striking_distance_seo')
  else fail('type', new Error(a.relevance.opportunity_type))

  section('B. 1st Edition Charizard — target evidence + urls + anti-template-rewrite guards')
  const b = buildClaudePrompt(fixtureCharizard())
  assertContains('B', b.prompt_text, '**Action ID:** `83206ad1-c713-455d-9db8-66e91e298867`')
  assertContains('B', b.prompt_text, '**Target URL:** `https://www.pokeprices.io/set/Base%20Set/card/charizard-1st-edition-4`')
  assertContains('B', b.prompt_text, '**Target query:** `first edition charizard psa 10`')
  assertContains('B', b.prompt_text, '## Target-level evidence')
  assertContains('B', b.prompt_text, '"clicks": 0')
  assertContains('B', b.prompt_text, '"impressions": 1901')
  assertContains('B', b.prompt_text, '## Site-wide baseline (context only — NOT a page-level verdict)')
  assertContains('B', b.prompt_text, 'Top queries ranking for this URL')
  assertContains('B', b.prompt_text, '`first edition charizard psa 10` — 342 impressions')
  // Anti-template-rewrite guard
  assertRegex('B', b.prompt_text, /do NOT edit any shared template|Smoke-test an UNRELATED card/i)
  assertRegex('B', b.prompt_text, /generateMetadata/i)
  // Must mention Stage D measurement recommendation
  assertContains('B', b.prompt_text, 'measurement_recommendation')
  // Should NOT contain duplicated background paragraph
  const summaryHits = (b.prompt_text.match(/14 queries, 1\.9k combined impressions/g) || []).length
  if (summaryHits === 1) pass('background summary appears exactly once (no duplication)')
  else fail('background not duplicated', new Error(`appeared ${summaryHits} times`))
  // Classification should still route to code_change
  if (b.implementation_type === 'code_change') pass('implementation_type = code_change')
  else fail('impl type', new Error(b.implementation_type))

  section('C. Site-wide technical — must NOT give single-page SEO instructions')
  const c = buildClaudePrompt(fixtureSiteWide())
  assertContains('C', c.prompt_text, 'site_wide_technical')
  assertContains('C', c.prompt_text, 'site-wide trend affecting many URLs')
  // Must NOT give striking-distance guidance here
  assertContains('C', c.prompt_text, 'ranking queries, search intent', true)  // invert = must NOT contain
  assertContains('C', c.prompt_text, 'deployment history for the affected app from Vercel')
  if (c.relevance.opportunity_type === 'site_wide_technical') pass('opportunity_type = site_wide_technical')
  else fail('type', new Error(c.relevance.opportunity_type))

  section('D. Insufficient evidence — must support NO CHANGE instead of forcing deployment')
  const d = buildClaudePrompt(fixtureInsufficient())
  if (d.relevance.verdict === 'insufficient_evidence') pass('relevance.verdict = insufficient_evidence')
  else fail('verdict', new Error(d.relevance.verdict))
  assertRegex('D', d.prompt_text, /below the 100-impression floor/i)
  assertContains('D', d.prompt_text, 'Default to NO CHANGE')
  assertContains('D', d.prompt_text, 'NO_CHANGE verdict is a successful outcome')

  section('E. High-risk change — must require approval before broad modification')
  const e = buildClaudePrompt(fixtureHighRisk())
  assertRegex('E', e.prompt_text, /Approval required|switch to INVESTIGATE_FURTHER/i)
  assertRegex('E', e.prompt_text, /canonical\/sitemap\/robots changes|canonical/i)
  // When the opportunity type is site-wide technical, the execute
  // guidance should mention stop-and-get-approval for templates.
  assertRegex('E', e.prompt_text, /any change rendering on >5 unrelated pages|canonical\/sitemap\/robots/i)

  section('F. Receipt validator — NO_CHANGE + INVESTIGATE_FURTHER accepted; v1 shape still works')
  const taskId = '00000000-0000-0000-0000-000000000001'
  // F1: v1-shape receipt (no decision field) still works, requires summary_of_what_changed
  const v1 = { action_id: taskId, completed_at: now.toISOString(), summary_of_what_changed: 'legacy summary' }
  const rF1 = parseAndValidateReceipt(JSON.stringify(v1), taskId)
  if (rF1.ok && rF1.value.decision === 'IMPLEMENT') pass('v1 receipt still validates; decision defaults to IMPLEMENT')
  else fail('v1 compat', new Error(JSON.stringify(rF1)))
  // F2: NO_CHANGE receipt without production SHA passes
  const noChange = {
    action_id: taskId, decision: 'NO_CHANGE', completed_at: now.toISOString(),
    summary_of_findings: 'Investigated the Newmarket event URL. Event date passed Oct 2026 and page is now archived. Recommend NO CHANGE.',
    validity_assessment: 'OS flagged potentially_stale. Investigation confirms the event is historical.',
  }
  const rF2 = parseAndValidateReceipt(JSON.stringify(noChange), taskId)
  if (rF2.ok && rF2.value.decision === 'NO_CHANGE') pass('NO_CHANGE receipt validates without production SHA')
  else fail('NO_CHANGE accept', new Error(JSON.stringify(rF2)))
  // F3: NO_CHANGE with a fake production SHA is REJECTED
  const falseClaim = { ...noChange, production_deployment_sha: '0000000000000000000000000000000000000000' }
  const rF3 = parseAndValidateReceipt(JSON.stringify(falseClaim), taskId)
  if (!rF3.ok && rF3.path === 'production_deployment_sha') pass('NO_CHANGE + production SHA rejected (correctness guardrail)')
  else fail('NO_CHANGE SHA guardrail', new Error(JSON.stringify(rF3)))
  // F4: INVESTIGATE_FURTHER with findings summary passes
  const inv = {
    action_id: taskId, decision: 'INVESTIGATE_FURTHER', completed_at: now.toISOString(),
    summary_of_findings: 'Canonical mismatch spans 20,000 pages. Fix is a one-line change in generateMetadata but affects every card page. Operator approval required.',
    issue_found: 'Shared generateMetadata helper writes canonical from an older URL shape.',
  }
  const rF4 = parseAndValidateReceipt(JSON.stringify(inv), taskId)
  if (rF4.ok && rF4.value.decision === 'INVESTIGATE_FURTHER') pass('INVESTIGATE_FURTHER receipt validates')
  else fail('INVESTIGATE_FURTHER accept', new Error(JSON.stringify(rF4)))
  // F5: Decision = IMPLEMENT requires summary_of_what_changed
  const badImpl = { action_id: taskId, decision: 'IMPLEMENT', completed_at: now.toISOString() }
  const rF5 = parseAndValidateReceipt(JSON.stringify(badImpl), taskId)
  if (!rF5.ok && rF5.path === 'summary_of_what_changed') pass('IMPLEMENT without summary rejected')
  else fail('IMPLEMENT requires summary', new Error(JSON.stringify(rF5)))

  section('G. Prompt hash is deterministic across repeated builds (idempotency)')
  const g1 = buildClaudePrompt(fixtureCharizard())
  const g2 = buildClaudePrompt(fixtureCharizard())
  if (g1.prompt_hash === g2.prompt_hash) pass('identical input → identical hash', g1.prompt_hash.slice(0, 12))
  else fail('determinism', new Error('hash drifted'))
  // Different relevance → different hash
  const nmHash = buildClaudePrompt(fixtureNewmarket()).prompt_hash
  if (nmHash !== g1.prompt_hash) pass('different inputs → different hashes')
  else fail('hash discrimination', new Error('collision'))

  section('H. Historical v1 prompt_hash preservation on regenerate')
  // We can't test v1 here (we removed it) but we assert the v2 hash
  // is a 64-char sha256 so metadata.generated_prompts can carry both
  // without collisions.
  if (/^[a-f0-9]{64}$/.test(g1.prompt_hash)) pass('v2 hash is sha256-shaped')
  else fail('hash shape', new Error(g1.prompt_hash))

  console.log('\n━━━ SUMMARY ━━━')
  const p = results.filter((r) => r.ok).length
  const f = results.filter((r) => !r.ok).length
  console.log(`${p} PASS, ${f} FAIL`)
  if (f > 0) {
    for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ ${r.n} — ${r.err}`)
    process.exit(1)
  }
}

try { main() } catch (e) { console.error('[fatal]', e); process.exit(1) }
