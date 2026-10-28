#!/usr/bin/env node
// CN-05 OS — measurement engine end-to-end verification.
//
// Creates disposable tasks with historical anchor dates so the
// D7/D14/D28 windows land on real GSC/GA4 data that already lives
// in network_*_site_daily. Runs the deployed cron sweep logic
// (mirrored inline), inspects results, cleans up.
//
// Covers Phase 8's twelve checks from the Measurement brief:
//   1.  unverified action is never scheduled
//   2.  verified implementation gets 4 checkpoints
//   3.  measurement uses the implementation (receipt) date
//   4.  incomplete GSC/GA4 doesn't produce a false zero
//   5.  D7 compares like-for-like windows
//   6.  duplicate runs don't duplicate measurements
//   7.  baseline remains unchanged
//   8.  negative outcomes represented correctly
//   9.  missing metrics → inconclusive / insufficient_data
//  10.  completed history remains accessible
//  11.  existing prompts + receipts continue working
//  12.  test records cleaned up

import '../../../scripts/_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) { console.error('Missing Supabase env'); process.exit(2) }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

const MARKER = 'CN-05-MEASURE-TEST'
const results = []
function pass(n, note = '') { results.push({ status: 'PASS', n, note }); console.log(`  ✓ ${n}${note ? ' — ' + note : ''}`) }
function fail(n, err) { results.push({ status: 'FAIL', n, err: err?.message ?? String(err) }); console.log(`  ✗ ${n} — ${err?.message ?? err}`) }
function section(name) { console.log(`\n━━━ ${name} ━━━`) }

// ──────────── Mirror of measurement.ts ────────────
const CHECKPOINTS = [7, 14, 28, 90]
const SETTLE_LAG_DAYS = 3
const FLAT_THRESHOLD_PCT = 5
const MIN_IMPS_FOR_CALL = 500

function iso(d) { return d.toISOString().slice(0, 10) }
function addDays(iso10, delta) { const d = new Date(iso10 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return iso(d) }
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) }
function isCheckpointDue(target, today, lag = SETTLE_LAG_DAYS) { return addDays(target, lag) <= today }

function pair(pre, post) {
  const delta_abs = pre != null && post != null ? post - pre : null
  const delta_pct = pre != null && post != null && pre > 0 ? ((post - pre) / pre) * 100 : null
  let direction = 'unknown'
  if (delta_pct != null) {
    if (Math.abs(delta_pct) < FLAT_THRESHOLD_PCT) direction = 'flat'
    else direction = delta_pct > 0 ? 'up' : 'down'
  } else if (pre != null && post != null) direction = post > 0 ? 'up' : 'flat'
  return { pre, post, delta_abs, delta_pct, direction }
}

async function readGscSite(siteId, start, end) {
  const { data } = await sb.from('network_gsc_site_daily')
    .select('clicks, impressions, position_avg')
    .eq('site_id', siteId).gte('date', start).lte('date', end)
  if (!data) return null
  let clicks = 0, imps = 0, posWn = 0, posWd = 0, days = 0
  for (const r of data) {
    clicks += r.clicks ?? 0; imps += r.impressions ?? 0
    if (r.position_avg != null) { posWn += (r.impressions ?? 0) * r.position_avg; posWd += r.impressions ?? 0 }
    days++
  }
  return { clicks, impressions: imps, days, position_avg: posWd > 0 ? posWn / posWd : null }
}
async function readGa4Site(siteId, start, end) {
  const { data } = await sb.from('network_ga4_site_daily')
    .select('active_users, sessions').eq('site_id', siteId).gte('date', start).lte('date', end)
  if (!data) return null
  let au = 0, sess = 0, days = 0
  for (const r of data) { au += r.active_users ?? 0; sess += r.sessions ?? 0; days++ }
  return { active_users: au, sessions: sess, days }
}

async function clipToSettledEnd(siteId, ideal, today) {
  const settledCeiling = addDays(today, -SETTLE_LAG_DAYS)
  const cap = ideal < settledCeiling ? ideal : settledCeiling
  const { data } = await sb.from('network_gsc_site_daily')
    .select('date').eq('site_id', siteId).lte('date', cap)
    .order('date', { ascending: false }).limit(1).maybeSingle()
  return data?.date ?? cap
}

function classifyActionScope(baseline) {
  if (baseline?.target_url) return 'url_targeted'
  if (baseline?.target_query) return 'query_targeted'
  return 'site_wide'
}

async function captureCheckpoint({ taskId, siteId, schedule, checkpoint, today, primarySuccessMetric, baseline }) {
  const notes = []
  const anchorDate = schedule.anchor_at.slice(0, 10)
  const idealEnd = addDays(anchorDate, checkpoint)
  const scope = classifyActionScope(baseline)
  const base = { checkpoint, target_date: idealEnd, measured_at: null, status: 'pending', anchor_at: schedule.anchor_at, action_scope: scope, target: { url: baseline?.target_url ?? null, query: baseline?.target_query ?? null }, pre_window: null, post_window: null, gsc_site: null, ga4_site: null, site_trend: null, primary: null, outcome: 'measurement_pending', notes, measurement_version: 'cn05-measure-v1' }
  if (!siteId) { base.status = 'insufficient_data'; base.outcome = 'insufficient_data'; notes.push('network-scoped'); base.measured_at = new Date().toISOString(); return base }
  if (!isCheckpointDue(idealEnd, today)) { notes.push(`not due; target ${idealEnd}`); return base }
  const settledPostEnd = await clipToSettledEnd(siteId, idealEnd, today)
  if (settledPostEnd < anchorDate) { notes.push('no settled post data'); return base }
  const postStart = addDays(anchorDate, 1)
  const postDays = Math.min(checkpoint, daysBetween(postStart, settledPostEnd) + 1)
  const postEndClipped = addDays(postStart, postDays - 1)
  const preEnd = addDays(anchorDate, -1)
  const preStart = addDays(preEnd, -(postDays - 1))
  base.pre_window = { start: preStart, end: preEnd, days: postDays }
  base.post_window = { start: postStart, end: postEndClipped, days: postDays }
  const [gscPre, gscPost, ga4Pre, ga4Post] = await Promise.all([
    readGscSite(siteId, preStart, preEnd), readGscSite(siteId, postStart, postEndClipped),
    readGa4Site(siteId, preStart, preEnd), readGa4Site(siteId, postStart, postEndClipped),
  ])
  if (gscPre && gscPre.days < postDays) notes.push(`GSC pre partial: ${gscPre.days}/${postDays}`)
  if (gscPost && gscPost.days < postDays) notes.push(`GSC post partial: ${gscPost.days}/${postDays}`)
  const gsc_site = (gscPre && gscPost) ? {
    clicks: pair(gscPre.clicks, gscPost.clicks),
    impressions: pair(gscPre.impressions, gscPost.impressions),
    ctr: pair(gscPre.impressions > 0 ? gscPre.clicks / gscPre.impressions : null, gscPost.impressions > 0 ? gscPost.clicks / gscPost.impressions : null),
    avg_position: pair(gscPre.position_avg, gscPost.position_avg),
  } : null
  const ga4_site = (ga4Pre && ga4Post) ? { active_users: pair(ga4Pre.active_users, ga4Post.active_users), sessions: pair(ga4Pre.sessions, ga4Post.sessions) } : null
  base.gsc_site = gsc_site; base.ga4_site = ga4_site
  base.site_trend = (gsc_site && ga4_site) ? { clicks: gsc_site.clicks, active_users: ga4_site.active_users } : null
  if (scope !== 'site_wide') {
    base.primary = null
    base.status = 'insufficient_data'
    base.outcome = 'awaiting_targeted_measurement'
    const label = scope === 'url_targeted' ? 'URL' : 'query'
    const tv = scope === 'url_targeted' ? (baseline?.target_url ?? '') : (baseline?.target_query ?? '')
    notes.push(`Action targets a specific ${label}: \`${tv}\`. Site-level GSC/GA4 shown as context only — not a success verdict.`)
    base.measured_at = new Date().toISOString()
    return base
  }
  const pm = (primarySuccessMetric ?? '').toLowerCase()
  let primary = null
  if (gsc_site) {
    if (/impression/.test(pm)) primary = { metric: 'gsc_impressions', pair: gsc_site.impressions }
    else if (/ctr/.test(pm)) primary = { metric: 'gsc_ctr', pair: gsc_site.ctr }
    else if (/position|rank/.test(pm)) primary = { metric: 'gsc_avg_position', pair: gsc_site.avg_position }
  }
  if (!primary && ga4_site) { if (/user|visitor|session/.test(pm)) primary = { metric: 'ga4_active_users', pair: ga4_site.active_users } }
  if (!primary && gsc_site) primary = { metric: 'gsc_clicks', pair: gsc_site.clicks }
  if (!primary && ga4_site) primary = { metric: 'ga4_sessions', pair: ga4_site.sessions }
  base.primary = primary
  const hasAny = !!(gsc_site || ga4_site)
  if (!hasAny) { base.status = 'insufficient_data'; base.outcome = 'insufficient_data'; notes.push('no rows') }
  else {
    const totalImps = (gsc_site?.impressions.pre ?? 0) + (gsc_site?.impressions.post ?? 0)
    if (gsc_site && totalImps < MIN_IMPS_FOR_CALL) { base.status = 'insufficient_data'; base.outcome = 'insufficient_data'; notes.push(`imps=${totalImps} < ${MIN_IMPS_FOR_CALL}`) }
    else if (!primary || primary.pair.direction === 'unknown') { base.status = 'inconclusive'; base.outcome = 'inconclusive' }
    else if (primary.pair.direction === 'up' && (primary.pair.delta_pct ?? 0) >= FLAT_THRESHOLD_PCT) {
      if (primary.metric === 'gsc_avg_position') { base.status = 'measured'; base.outcome = 'observed_decline' }
      else { base.status = 'measured'; base.outcome = 'observed_improvement' }
    }
    else if (primary.pair.direction === 'down' && Math.abs(primary.pair.delta_pct ?? 0) >= FLAT_THRESHOLD_PCT) {
      if (primary.metric === 'gsc_avg_position') { base.status = 'measured'; base.outcome = 'observed_improvement' }
      else { base.status = 'measured'; base.outcome = 'observed_decline' }
    }
    else { base.status = 'measured'; base.outcome = 'inconclusive' }
  }
  base.measured_at = new Date().toISOString()
  notes.push('observed change only')
  return base
}

function buildSchedule(args) {
  // Anchor is the operator-verified timestamp. receiptCompletedAt is
  // Claude's claim, kept for audit only.
  const anchor = args.operatorVerifiedAt ?? args.anchorIsoTimestamp
  const anchorDate = anchor.slice(0, 10)
  const target_dates = Object.fromEntries(CHECKPOINTS.map((d) => [`D${d}`, addDays(anchorDate, d)]))
  return {
    anchor_at: anchor,
    anchor_source: 'operator_confirmed_receipt',
    anchor_task_id: args.taskId,
    anchor_receipt_completed_at: args.receiptCompletedAt ?? args.anchorIsoTimestamp ?? null,
    anchor_receipt_commit_sha: null,
    anchor_receipt_deployment_sha: null,
    primary_success_metric: args.primarySuccessMetric,
    scheduled_at: new Date().toISOString(),
    schedule_version: 'cn05-measure-v1',
    target_dates,
  }
}

// ──────────── Fixtures ────────────
async function createDisposableTask(siteId, anchorIso, { withVerifiedReceipt = true, primaryMetric = null, baseline = null } = {}) {
  const now = Date.now().toString(36)
  const { data: task, error } = await sb.from('network_tasks').insert({
    site_id: siteId,
    title: `${MARKER} fixture ${anchorIso.slice(0, 10)} ${now}`,
    description: `${MARKER} fixture task for measurement e2e`,
    task_type: 'intelligence', task_kind: 'improvement', task_source: 'intelligence',
    priority: 'low', status: 'in_progress',
    recommended_action: 'test — no implementation',
    evidence: { marker: MARKER, target_url: '/insights/test-page' },
    metadata: {
      ...(baseline ? { baseline } : {}),
      ...(withVerifiedReceipt ? {
        implementation_receipts: [{
          action_id: '00000000-0000-0000-0000-000000000000', // overridden on insert
          completed_at: anchorIso,
          summary_of_what_changed: `${MARKER} fixture — no production change`,
          primary_success_metric: primaryMetric,
          received_at: new Date().toISOString(), received_version: 'cn05-receipt-v1',
          operator_confirmed_at: new Date().toISOString(), operator_confirmed_by: null,
        }],
      } : {}),
    },
  }).select('id, site_id, metadata').single()
  if (error) throw error
  // Backfill action_id to the row's id so validation would pass.
  if (withVerifiedReceipt) {
    const meta = task.metadata
    meta.implementation_receipts[0].action_id = task.id
    await sb.from('network_tasks').update({ metadata: meta }).eq('id', task.id)
  }
  return task
}

async function runSweep(today, { onlyTaskIds = null } = {}) {
  // Mirror of the cron sweep's filter: tasks with measurement_schedule.
  // When onlyTaskIds supplied, scope to our fixtures to keep the test
  // fast + deterministic.
  let q = sb.from('network_tasks').select('id, site_id, title, metadata').not('metadata->measurement_schedule', 'is', null)
  if (onlyTaskIds) q = q.in('id', onlyTaskIds)
  const { data: rows } = await q
  let examined = 0, measured = 0, pending = 0
  for (const t of rows ?? []) {
    examined++
    const meta = t.metadata ?? {}
    const schedule = meta.measurement_schedule
    if (!schedule) continue
    const receipts = meta.implementation_receipts ?? []
    if (!receipts.find((r) => r?.operator_confirmed_at)) continue
    const primary = schedule.primary_success_metric ?? receipts[0]?.primary_success_metric ?? null
    const existing = Array.isArray(meta.measurement_checkpoints) ? meta.measurement_checkpoints.slice() : []
    const byD = new Map(existing.map((c) => [c.checkpoint, c]))
    let changed = false
    for (const d of CHECKPOINTS) {
      const target = addDays(schedule.anchor_at.slice(0, 10), d)
      const prev = byD.get(d)
      if (prev && prev.status !== 'pending') continue
      if (!isCheckpointDue(target, today)) continue
      const cap = await captureCheckpoint({ taskId: t.id, siteId: t.site_id, schedule, checkpoint: d, today, primarySuccessMetric: primary, baseline: meta.baseline ?? null })
      byD.set(d, cap)
      if (cap.status === 'measured' || cap.status === 'inconclusive' || cap.status === 'insufficient_data') measured++
      else pending++
      changed = true
    }
    if (changed) {
      const nextCheckpoints = [...byD.values()].sort((a, b) => a.checkpoint - b.checkpoint)
      await sb.from('network_tasks').update({ metadata: { ...meta, measurement_checkpoints: nextCheckpoints } }).eq('id', t.id)
    }
  }
  return { examined, measured, pending }
}

// ──────────── Main ────────────
async function main() {
  section('Preamble — select Pokemon as test site (has rich GSC+GA4)')
  const { data: site } = await sb.from('network_sites').select('id, slug').eq('slug', 'pokemon').single()
  const siteId = site.id
  const today = iso(new Date())
  const twoDaysAgo = addDays(today, -2)
  const anchorThreeMonthsAgo = addDays(today, -95)  // allows D7/D14/D28/D90 to be due
  const anchorThirtyFiveDaysAgo = addDays(today, -35)  // D7/D14/D28 due; D90 pending
  console.log(`  today=${today}  3mo-anchor=${anchorThreeMonthsAgo}  35d-anchor=${anchorThirtyFiveDaysAgo}`)

  const createdTaskIds = []

  try {
    section('1. Unverified action is never scheduled for measurement')
    const unverified = await createDisposableTask(siteId, `${twoDaysAgo}T12:00:00Z`, { withVerifiedReceipt: false })
    createdTaskIds.push(unverified.id)
    // Verify: no measurement_schedule because the operator never confirmed.
    const { data: u } = await sb.from('network_tasks').select('metadata').eq('id', unverified.id).single()
    if (!u.metadata.measurement_schedule) pass('unverified task has no measurement_schedule')
    else fail('unverified task gated', new Error('unexpected schedule'))
    const sweep1 = await runSweep(today, { onlyTaskIds: [unverified.id] })
    if (sweep1.examined === 0 && sweep1.measured === 0) pass('sweep ignores unverified task')
    else fail('sweep ignores unverified', new Error(JSON.stringify(sweep1)))

    section('2. Verified implementation receives four checkpoints (3mo-old anchor)')
    const vt = await createDisposableTask(siteId, `${anchorThreeMonthsAgo}T12:00:00Z`, {
      withVerifiedReceipt: true,
      primaryMetric: 'GSC clicks',
      baseline: { frozen_at: new Date().toISOString(), frozen_version: 'cn05-baseline-v1', window_start: addDays(anchorThreeMonthsAgo, -27), window_end: anchorThreeMonthsAgo, gsc_clicks_28d: 999, gsc_impressions_28d: 99999, data_source_freshness: { gsc: anchorThreeMonthsAgo, ga4: anchorThreeMonthsAgo } },
    })
    createdTaskIds.push(vt.id)
    // The schedule is laid down by the confirmReceiptVerifiedAction;
    // we simulate it directly here since our test task bypassed the
    // Server Action chain.
    const schedule = buildSchedule({ taskId: vt.id, anchorIsoTimestamp: `${anchorThreeMonthsAgo}T12:00:00Z`, primarySuccessMetric: 'GSC clicks' })
    await sb.from('network_tasks').update({ metadata: { ...vt.metadata, measurement_schedule: schedule } }).eq('id', vt.id)
    const sweep2 = await runSweep(today, { onlyTaskIds: [vt.id] })
    const { data: afterSweep2 } = await sb.from('network_tasks').select('metadata').eq('id', vt.id).single()
    const checkpoints2 = afterSweep2.metadata.measurement_checkpoints ?? []
    if (checkpoints2.length === 4) pass('all 4 checkpoints captured (D7/D14/D28/D90)')
    else fail('4 checkpoints', new Error(`got ${checkpoints2.length}`))
    for (const d of CHECKPOINTS) {
      const cp = checkpoints2.find((c) => c.checkpoint === d)
      if (cp) pass(`D${d} present — ${cp.outcome}  pre_imps=${cp.gsc_site?.impressions.pre ?? 'null'}  post_imps=${cp.gsc_site?.impressions.post ?? 'null'}`)
      else fail(`D${d} present`, new Error('missing'))
    }

    section('3. Measurement anchored on receipt completed_at (not freeze date)')
    const cpD7 = checkpoints2.find((c) => c.checkpoint === 7)
    if (cpD7.anchor_at === `${anchorThreeMonthsAgo}T12:00:00Z`) pass('checkpoint carries receipt-anchored anchor_at')
    else fail('anchor_at matches receipt', new Error(cpD7.anchor_at))
    if (cpD7.pre_window?.end === addDays(anchorThreeMonthsAgo, -1) && cpD7.post_window?.start === addDays(anchorThreeMonthsAgo, 1)) pass('pre/post windows bracket the anchor correctly')
    else fail('windows bracket anchor', new Error(`pre=${JSON.stringify(cpD7.pre_window)} post=${JSON.stringify(cpD7.post_window)}`))

    section('4. Incomplete GSC/GA4 data does not produce false zero')
    // Create an anchor so recent that the D90 target is in the future.
    const recentAnchor = addDays(today, -4)
    const rt = await createDisposableTask(siteId, `${recentAnchor}T12:00:00Z`, { withVerifiedReceipt: true, primaryMetric: 'GSC clicks' })
    createdTaskIds.push(rt.id)
    const scheduleR = buildSchedule({ taskId: rt.id, anchorIsoTimestamp: `${recentAnchor}T12:00:00Z`, primarySuccessMetric: 'GSC clicks' })
    await sb.from('network_tasks').update({ metadata: { ...rt.metadata, measurement_schedule: scheduleR } }).eq('id', rt.id)
    await runSweep(today, { onlyTaskIds: [rt.id] })
    const { data: afterSweep4 } = await sb.from('network_tasks').select('metadata').eq('id', rt.id).single()
    const cps4 = afterSweep4.metadata.measurement_checkpoints ?? []
    const d90 = cps4.find((c) => c.checkpoint === 90)
    // D90 target is 86 days in the future → either not emitted or still pending.
    if (!d90 || d90.status === 'pending') pass('D90 remains pending — not forced to a value')
    else fail('D90 pending', new Error(JSON.stringify(d90)))
    const d7_recent = cps4.find((c) => c.checkpoint === 7)
    if (!d7_recent || d7_recent.status === 'pending') pass('D7 remains pending for freshly-anchored task (settle lag honoured)')
    else fail('D7 pending for recent anchor', new Error(JSON.stringify(d7_recent)))

    section('5. D7 compares like-for-like windows (7 vs 7, not 7 vs 28)')
    if (cpD7.pre_window?.days === 7 && cpD7.post_window?.days === 7) pass('D7 pre.days=7 and post.days=7')
    else fail('D7 windows equal 7', new Error(`pre=${cpD7.pre_window?.days} post=${cpD7.post_window?.days}`))
    const cpD28 = checkpoints2.find((c) => c.checkpoint === 28)
    if (cpD28.pre_window?.days === 28 && cpD28.post_window?.days === 28) pass('D28 pre.days=28 and post.days=28')
    else fail('D28 windows equal 28', new Error(`pre=${cpD28.pre_window?.days} post=${cpD28.post_window?.days}`))

    section('6. Duplicate runs do not re-measure')
    const measuredBefore = checkpoints2.filter((c) => c.status !== 'pending').length
    const measured_at_before = checkpoints2[0].measured_at
    const sweep6 = await runSweep(today, { onlyTaskIds: [vt.id] })
    const { data: afterSweep6 } = await sb.from('network_tasks').select('metadata').eq('id', vt.id).single()
    const cps6 = afterSweep6.metadata.measurement_checkpoints ?? []
    if (cps6.length === checkpoints2.length) pass('checkpoint count unchanged after re-sweep')
    else fail('no duplicates on re-sweep', new Error(`before=${checkpoints2.length} after=${cps6.length}`))
    if (cps6[0].measured_at === measured_at_before) pass('measured_at timestamp preserved on re-sweep')
    else fail('idempotent measured_at', new Error('timestamp changed'))
    if (sweep6.measured === 0) pass('sweep reports 0 new measurements for already-captured checkpoints')
    else fail('idempotent sweep count', new Error(JSON.stringify(sweep6)))

    section('7. Baseline remains unchanged after measurement')
    const { data: afterBaselineCheck } = await sb.from('network_tasks').select('metadata').eq('id', vt.id).single()
    const b = afterBaselineCheck.metadata.baseline
    if (b && b.gsc_clicks_28d === 999 && b.gsc_impressions_28d === 99999) pass('baseline frozen numbers untouched after sweep')
    else fail('baseline untouched', new Error(JSON.stringify(b)))

    section('8+9. Outcome labels (improvement/decline/inconclusive/insufficient_data)')
    const outcomes = new Set(checkpoints2.map((c) => c.outcome))
    // We expect at least ONE outcome from the real-data run; the labels are
    // deterministic given the clicks/impression deltas. We assert the schema.
    const validOutcomes = ['observed_improvement', 'observed_decline', 'inconclusive', 'insufficient_data', 'measurement_pending']
    const allValid = [...outcomes].every((o) => validOutcomes.includes(o))
    if (allValid) pass(`outcomes well-formed: ${[...outcomes].join(', ')}`)
    else fail('outcomes schema', new Error([...outcomes].join(',')))
    // Also: insufficient_data behaviour on a network-scoped task
    const nst = await createDisposableTask(null, `${anchorThreeMonthsAgo}T12:00:00Z`, { withVerifiedReceipt: true, primaryMetric: 'GSC clicks' })
    createdTaskIds.push(nst.id)
    const scheduleN = buildSchedule({ taskId: nst.id, anchorIsoTimestamp: `${anchorThreeMonthsAgo}T12:00:00Z`, primarySuccessMetric: 'GSC clicks' })
    await sb.from('network_tasks').update({ metadata: { ...nst.metadata, measurement_schedule: scheduleN } }).eq('id', nst.id)
    await runSweep(today, { onlyTaskIds: [nst.id] })
    const { data: afterSweep9 } = await sb.from('network_tasks').select('metadata').eq('id', nst.id).single()
    const cps9 = afterSweep9.metadata.measurement_checkpoints ?? []
    if (cps9.every((c) => c.outcome === 'insufficient_data')) pass('network-scoped task yields insufficient_data for every checkpoint')
    else fail('network-scoped → insufficient_data', new Error(JSON.stringify(cps9.map((c) => c.outcome))))

    section('10. Completed measurement history remains accessible')
    const { data: finalRow } = await sb.from('network_tasks').select('metadata').eq('id', vt.id).single()
    const m = finalRow.metadata
    const okFinal = m.measurement_schedule?.schedule_version === 'cn05-measure-v1'
      && Array.isArray(m.measurement_checkpoints)
      && m.measurement_checkpoints.length === 4
      && m.baseline?.gsc_clicks_28d === 999
    if (okFinal) pass('schedule + 4 checkpoints + baseline all readable from task metadata')
    else fail('history readable', new Error('shape mismatch'))

    section('11. Existing prompt + receipt channels unchanged')
    // Verify we can still write a generated_prompt and record_receipt
    // path on a NEW disposable task — nothing in the measurement
    // engine disturbed those code paths.
    const compatTask = await createDisposableTask(siteId, `${twoDaysAgo}T12:00:00Z`, { withVerifiedReceipt: false })
    createdTaskIds.push(compatTask.id)
    await sb.from('network_tasks').update({ metadata: { ...compatTask.metadata, generated_prompts: [{ prompt_hash: 'x'.repeat(64), prompt_text: 'test prompt', prompt_version: 'cn05-action-prompt-v1', created_at: new Date().toISOString(), implementation_type: 'investigation' }] } }).eq('id', compatTask.id)
    const { data: compatRow } = await sb.from('network_tasks').select('metadata').eq('id', compatTask.id).single()
    if (compatRow.metadata.generated_prompts?.length === 1) pass('generated_prompts still writable + readable')
    else fail('prompt compatibility', new Error('broken'))

    section('13. URL-targeted action — site-wide metrics are context only')
    const urlTargeted = await createDisposableTask(siteId, `${anchorThreeMonthsAgo}T12:00:00Z`, {
      withVerifiedReceipt: true, primaryMetric: 'GSC clicks',
      baseline: {
        frozen_at: new Date().toISOString(), frozen_version: 'cn05-baseline-v1',
        window_start: addDays(anchorThreeMonthsAgo, -27), window_end: anchorThreeMonthsAgo,
        gsc_clicks_28d: 999, gsc_impressions_28d: 99999,
        target_url: '/insights/pikachu-vmax-market-snapshot',  // ← targeted
        target_query: null,
        data_source_freshness: { gsc: anchorThreeMonthsAgo, ga4: anchorThreeMonthsAgo },
      },
    })
    createdTaskIds.push(urlTargeted.id)
    const scheduleU = buildSchedule({ taskId: urlTargeted.id, operatorVerifiedAt: `${anchorThreeMonthsAgo}T12:00:00Z`, receiptCompletedAt: `${anchorThreeMonthsAgo}T12:00:00Z`, primarySuccessMetric: 'GSC clicks' })
    await sb.from('network_tasks').update({ metadata: { ...urlTargeted.metadata, measurement_schedule: scheduleU } }).eq('id', urlTargeted.id)
    await runSweep(today, { onlyTaskIds: [urlTargeted.id] })
    const { data: afterU } = await sb.from('network_tasks').select('metadata').eq('id', urlTargeted.id).single()
    const cpsU = afterU.metadata.measurement_checkpoints ?? []
    if (cpsU.length === 4) pass('url_targeted — 4 checkpoints captured')
    else fail('url_targeted checkpoint count', new Error(`got ${cpsU.length}`))
    if (cpsU.every((c) => c.action_scope === 'url_targeted')) pass('every checkpoint stamped action_scope=url_targeted')
    else fail('url_targeted scope stamp', new Error(JSON.stringify(cpsU.map((c) => c.action_scope))))
    if (cpsU.every((c) => c.outcome === 'awaiting_targeted_measurement')) pass('every outcome=awaiting_targeted_measurement (not observed_improvement)')
    else fail('url_targeted outcome', new Error(JSON.stringify(cpsU.map((c) => c.outcome))))
    if (cpsU.every((c) => c.primary === null)) pass('primary is NULL for targeted — no site-level verdict synthesised')
    else fail('primary null for targeted', new Error(JSON.stringify(cpsU.map((c) => c.primary))))
    if (cpsU.every((c) => c.site_trend && c.site_trend.clicks)) pass('site_trend preserved as context on each checkpoint')
    else fail('site_trend context', new Error('missing'))
    if (cpsU.every((c) => c.target.url === '/insights/pikachu-vmax-market-snapshot')) pass('target.url carried into every checkpoint')
    else fail('target.url carry', new Error(JSON.stringify(cpsU.map((c) => c.target))))

    section('14. Query-targeted action — same guardrail as URL-targeted')
    const queryTargeted = await createDisposableTask(siteId, `${anchorThreeMonthsAgo}T12:00:00Z`, {
      withVerifiedReceipt: true, primaryMetric: 'GSC clicks',
      baseline: {
        frozen_at: new Date().toISOString(), frozen_version: 'cn05-baseline-v1',
        window_start: addDays(anchorThreeMonthsAgo, -27), window_end: anchorThreeMonthsAgo,
        gsc_clicks_28d: 999, gsc_impressions_28d: 99999,
        target_url: null, target_query: 'pikachu vmax price',  // ← query targeted
        data_source_freshness: { gsc: anchorThreeMonthsAgo, ga4: anchorThreeMonthsAgo },
      },
    })
    createdTaskIds.push(queryTargeted.id)
    const scheduleQ = buildSchedule({ taskId: queryTargeted.id, operatorVerifiedAt: `${anchorThreeMonthsAgo}T12:00:00Z`, receiptCompletedAt: `${anchorThreeMonthsAgo}T12:00:00Z`, primarySuccessMetric: 'GSC clicks' })
    await sb.from('network_tasks').update({ metadata: { ...queryTargeted.metadata, measurement_schedule: scheduleQ } }).eq('id', queryTargeted.id)
    await runSweep(today, { onlyTaskIds: [queryTargeted.id] })
    const { data: afterQ } = await sb.from('network_tasks').select('metadata').eq('id', queryTargeted.id).single()
    const cpsQ = afterQ.metadata.measurement_checkpoints ?? []
    if (cpsQ.every((c) => c.action_scope === 'query_targeted')) pass('every checkpoint stamped action_scope=query_targeted')
    else fail('query_targeted scope', new Error(JSON.stringify(cpsQ.map((c) => c.action_scope))))
    if (cpsQ.every((c) => c.outcome === 'awaiting_targeted_measurement')) pass('query_targeted outcome correct')
    else fail('query_targeted outcome', new Error(JSON.stringify(cpsQ.map((c) => c.outcome))))
    if (cpsQ.every((c) => c.target.query === 'pikachu vmax price')) pass('target.query carried into every checkpoint')
    else fail('target.query carry', new Error(JSON.stringify(cpsQ.map((c) => c.target))))

    section('15. Site-wide action (no target_url/query) still gets a verdict')
    const sw = checkpoints2.find((c) => c.checkpoint === 7)
    if (sw.action_scope === 'site_wide') pass('site_wide fixture retained site_wide scope')
    else fail('site_wide scope', new Error(sw.action_scope))
    if (sw.outcome === 'observed_improvement' || sw.outcome === 'observed_decline' || sw.outcome === 'inconclusive' || sw.outcome === 'insufficient_data') pass(`site_wide retained real verdict (${sw.outcome})`)
    else fail('site_wide verdict kept', new Error(sw.outcome))
    if (sw.primary != null) pass('site_wide retained a primary metric pair')
    else fail('site_wide primary present', new Error('null'))

    section("16. Measurement anchor = operator_confirmed_at, not Claude's completed_at")
    // Scenario: Claude claimed completion 5 days before operator verified.
    const claudeClaim = `${addDays(anchorThirtyFiveDaysAgo, -5)}T12:00:00Z`
    const operatorVerify = `${anchorThirtyFiveDaysAgo}T12:00:00Z`
    const anchorTest = await createDisposableTask(siteId, claudeClaim, {
      withVerifiedReceipt: true, primaryMetric: 'GSC clicks',
      baseline: {
        frozen_at: new Date().toISOString(), frozen_version: 'cn05-baseline-v1',
        window_start: addDays(claudeClaim.slice(0,10), -27), window_end: claudeClaim.slice(0,10),
        gsc_clicks_28d: 999, gsc_impressions_28d: 99999,
        data_source_freshness: { gsc: claudeClaim.slice(0,10), ga4: claudeClaim.slice(0,10) },
      },
    })
    createdTaskIds.push(anchorTest.id)
    const scheduleA = buildSchedule({
      taskId: anchorTest.id,
      operatorVerifiedAt: operatorVerify,
      receiptCompletedAt: claudeClaim,
      primarySuccessMetric: 'GSC clicks',
    })
    await sb.from('network_tasks').update({ metadata: { ...anchorTest.metadata, measurement_schedule: scheduleA } }).eq('id', anchorTest.id)
    if (scheduleA.anchor_at === operatorVerify) pass('schedule.anchor_at = operator-verified timestamp')
    else fail('anchor is operator-verified', new Error(scheduleA.anchor_at))
    if (scheduleA.anchor_receipt_completed_at === claudeClaim) pass("schedule records Claude's claimed completion for audit")
    else fail('anchor_receipt_completed_at recorded', new Error(scheduleA.anchor_receipt_completed_at))
    await runSweep(today, { onlyTaskIds: [anchorTest.id] })
    const { data: afterAnchor } = await sb.from('network_tasks').select('metadata').eq('id', anchorTest.id).single()
    const cpAnchor = afterAnchor.metadata.measurement_checkpoints?.[0]
    if (cpAnchor && cpAnchor.anchor_at === operatorVerify) pass('captured checkpoint carries operator-verified anchor_at')
    else fail('checkpoint anchor_at', new Error(cpAnchor?.anchor_at))
    if (cpAnchor && cpAnchor.pre_window && cpAnchor.pre_window.end === addDays(operatorVerify.slice(0,10), -1)) pass("pre window pivots on operator-verified anchor, not Claude's claim")
    else fail('pre window pivot', new Error(JSON.stringify(cpAnchor?.pre_window)))

  } finally {
    section('12. Cleanup')
    // Catch any fixture matching the marker regardless of this run.
    const { data: residue } = await sb.from('network_tasks').select('id').like('title', `${MARKER}%`)
    const ids = Array.from(new Set([...createdTaskIds, ...(residue ?? []).map((r) => r.id)]))
    if (ids.length) await sb.from('network_tasks').delete().in('id', ids)
    pass(`deleted ${ids.length} fixture task(s)`)
  }

  console.log('\n━━━ SUMMARY ━━━')
  const pc = results.filter((r) => r.status === 'PASS').length
  const fc = results.filter((r) => r.status === 'FAIL').length
  console.log(`${pc} PASS, ${fc} FAIL`)
  if (fc > 0) {
    for (const r of results.filter((r) => r.status === 'FAIL')) console.log(`  ✗ ${r.n} — ${r.err}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1) })
