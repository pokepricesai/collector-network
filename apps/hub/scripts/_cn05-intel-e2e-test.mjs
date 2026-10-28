#!/usr/bin/env node
// CN-05 OS Intelligence workflow — end-to-end verification against
// PRODUCTION Supabase (project egidpsrkqvymvioidatc).
//
// Mirrors the exact logic of the deployed Server Actions:
//   * intelligence/actions.ts  → convertToTask / linkage
//   * tasks/[id]/actions.ts    → generateClaudePromptAction,
//                                freezeBaselineAction,
//                                recordClaudeImplementationAction,
//                                confirmReceiptVerifiedAction
//   * claude/baseline.ts       → buildBaselineSnapshot
//   * claude/action-prompt.ts  → buildClaudePrompt (relevant fragments)
//   * claude/completion-receipt.ts → parseAndValidateReceipt
//
// Test rows are tagged [CN-05-INTEL-TEST] in title + marker in the
// evidence jsonb so cleanup can find them. Nothing public is touched;
// baseline reads are purely GSC/GA4 views.
//
// Run:  node apps/hub/scripts/_cn05-intel-e2e-test.mjs

import '../../../scripts/_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) { console.error('Missing Supabase env'); process.exit(2) }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

const MARKER = 'CN-05-INTEL-TEST'
const results = []
function pass(name, note = '') { results.push({ status: 'PASS', name, note }); console.log(`  ✓ ${name}${note ? ' — ' + note : ''}`) }
function fail(name, err) { results.push({ status: 'FAIL', name, err: err?.message ?? String(err) }); console.log(`  ✗ ${name} — ${err?.message ?? err}`) }
function section(name) { console.log(`\n━━━ ${name} ━━━`) }

// ─────── Mirror of apps/hub/src/server/claude/baseline.ts ────────
function iso(d) { return d.toISOString().slice(0, 10) }
function addDays(iso10, delta) { const d = new Date(iso10 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return iso(d) }
async function latestDataDate(table, siteId) {
  let q = sb.from(table).select('date').order('date', { ascending: false }).limit(1)
  if (siteId) q = q.eq('site_id', siteId)
  const { data } = await q.maybeSingle()
  return data?.date ?? null
}
async function buildBaselineSnapshot({ siteId, siteSlug, evidenceTargetUrl, evidenceTargetQuery }) {
  const notes = []
  const [latestGsc, latestGa4] = await Promise.all([
    latestDataDate('network_gsc_site_daily', siteId),
    latestDataDate('network_ga4_site_daily', siteId),
  ])
  if (!latestGsc) notes.push('No GSC rows available for this site; GSC metrics left null.')
  if (!latestGa4) notes.push('No GA4 rows available for this site; GA4 metrics left null.')
  const windowEnd = latestGsc && latestGa4 ? (latestGsc < latestGa4 ? latestGsc : latestGa4) : (latestGsc ?? latestGa4 ?? null)
  const windowStart = windowEnd ? addDays(windowEnd, -27) : null
  let gsc_clicks = 0, gsc_imps = 0, pwi = 0, pwc = 0, posWn = 0, posWd = 0, gscRowCount = 0
  if (windowStart && windowEnd && siteId) {
    const { data: gscRows } = await sb.from('network_gsc_site_daily')
      .select('clicks, impressions, pages_with_impressions, pages_with_clicks, position_avg')
      .eq('site_id', siteId).gte('date', windowStart).lte('date', windowEnd)
    for (const r of gscRows ?? []) {
      gsc_clicks += r.clicks ?? 0; gsc_imps += r.impressions ?? 0
      pwi += r.pages_with_impressions ?? 0; pwc += r.pages_with_clicks ?? 0
      if (r.position_avg != null) { posWn += (r.impressions ?? 0) * r.position_avg; posWd += r.impressions ?? 0 }
      gscRowCount++
    }
    if (gscRowCount > 0 && gscRowCount < 20) notes.push(`GSC window is partial — only ${gscRowCount} of ~28 days present.`)
  }
  let ga4_users = 0, ga4_sessions = 0
  if (windowStart && windowEnd && siteId) {
    const { data: raw } = await sb.from('network_ga4_site_daily')
      .select('active_users, sessions').eq('site_id', siteId).gte('date', windowStart).lte('date', windowEnd)
    for (const r of raw ?? []) { ga4_users += r.active_users ?? 0; ga4_sessions += r.sessions ?? 0 }
  }
  const no_gsc_data = gsc_imps === 0 && gsc_clicks === 0 && gscRowCount === 0
  const no_ga4_data = ga4_users === 0 && ga4_sessions === 0
  return {
    frozen_at: new Date().toISOString(),
    frozen_version: 'cn05-baseline-v1',
    target_site_id: siteId, target_site_slug: siteSlug,
    target_url: evidenceTargetUrl, target_query: evidenceTargetQuery,
    window_start: windowStart, window_end: windowEnd,
    data_source_freshness: { gsc: latestGsc, ga4: latestGa4 },
    gsc_clicks_28d: no_gsc_data ? null : gsc_clicks,
    gsc_impressions_28d: no_gsc_data ? null : gsc_imps,
    gsc_pages_with_impressions_28d: no_gsc_data ? null : pwi,
    gsc_pages_with_clicks_28d: no_gsc_data ? null : pwc,
    gsc_avg_position_28d: posWd > 0 ? posWn / posWd : null,
    gsc_avg_ctr_28d: gsc_imps > 0 ? gsc_clicks / gsc_imps : null,
    ga4_active_users_28d: no_ga4_data ? null : ga4_users,
    ga4_sessions_28d: no_ga4_data ? null : ga4_sessions,
    notes, no_gsc_data, no_ga4_data,
  }
}
function extractEvidenceTargets(taskEv, intelEv) {
  const sources = [taskEv ?? {}, intelEv ?? {}]
  const urlKeys = ['target_url', 'url', 'page', 'target_page', 'affected_page']
  const queryKeys = ['target_query', 'query']
  let target_url = null, target_query = null
  for (const src of sources) {
    for (const k of urlKeys) { const v = src?.[k]; if (typeof v === 'string' && v.trim() && !target_url) target_url = v.trim() }
    for (const k of queryKeys) { const v = src?.[k]; if (typeof v === 'string' && v.trim() && !target_query) target_query = v.trim() }
  }
  return { target_url, target_query }
}

// ─────── Mirror of apps/hub/src/server/claude/action-prompt.ts ────────
// Full prompt builder — same shape as the deployed buildClaudePrompt so
// the test can assert on exact fragments the brief requires.
const PROMPT_VERSION = 'cn05-action-prompt-v1'
function classifyAction(task, intel) {
  const kind = task.task_kind
  const type = task.task_type
  const cat = (intel?.category ?? '').toLowerCase()
  if (type === 'intelligence' && kind === 'improvement' && cat === 'content') return 'content_edit'
  if (type === 'intelligence' && kind === 'improvement' && (cat === 'commercial' || cat === 'partnership')) return 'commercial_outreach'
  if (type === 'intelligence' && cat === 'data_quality') return 'data_quality_fix'
  if (type === 'intelligence' && cat === 'manual_platform') return 'manual_platform_action'
  if (type === 'intelligence' && kind === 'investigation') return 'investigation'
  return 'code_change'
}
function repoHintForSite(slug) {
  switch ((slug ?? '').toLowerCase()) {
    case 'pokemon':   return { repo: 'pokeprices-web (separate GitHub repo)', app: 'root' }
    case 'mtg':       return { repo: 'mtgprices-web (separate GitHub repo)', app: 'root' }
    case 'ygo':       return { repo: 'collector-network', app: 'apps/yugioh' }
    case 'onepiece':  return { repo: 'collector-network', app: 'apps/onepiece' }
    case 'lorcana':   return { repo: 'collector-network', app: 'apps/lorcana' }
    default:          return null
  }
}
function buildClaudePrompt({ task, site, intel, baseline }) {
  const implType = classifyAction(task, intel)
  const repoHint = repoHintForSite(site?.slug ?? null)
  const sections = []
  sections.push(`# CN-05 Action: ${task.title}`)
  sections.push(`**Action ID:** \`${task.id}\``)
  sections.push(`**Site:** ${site?.name ?? 'Network'} (${site?.slug ?? 'network'})${site?.domain ? ` — https://${site.domain}` : ''}`)
  sections.push(`**Priority:** ${task.priority}`)
  sections.push(`**Kind:** ${task.task_kind} · ${task.task_type}`)
  sections.push(`**Classification:** \`${implType}\``)
  if (intel) { sections.push(`**Opportunity category:** ${intel.category}`); sections.push(`**Signal kind:** opportunity`) }
  sections.push('\n## Background')
  if (intel?.summary) sections.push(intel.summary)
  if (task.description) sections.push(task.description)
  const evidencePayload = { task_evidence: task.evidence ?? {}, intel_evidence: intel?.evidence ?? null, expected_upside: intel?.expected_upside ?? null }
  sections.push('\n## Supporting evidence'); sections.push('```json'); sections.push(JSON.stringify(evidencePayload, null, 2)); sections.push('```')
  sections.push('\n## Recommended action')
  sections.push(intel?.recommended_action ?? task.recommended_action ?? 'Not specified — see Background.')
  sections.push('\n## Implementation instructions')
  sections.push(`Repository: **${repoHint?.repo ?? 'identify from site'}**`)
  if (baseline) {
    sections.push('\n## Frozen baseline (pre-change snapshot)')
    sections.push(`Frozen at ${baseline.frozen_at}. Window: ${baseline.window_start} → ${baseline.window_end}.`)
    if (baseline.target_url) sections.push(`Target URL: \`${baseline.target_url}\``)
    if (baseline.target_query) sections.push(`Target query: \`${baseline.target_query}\``)
    sections.push('```json')
    sections.push(JSON.stringify({ window: { start: baseline.window_start, end: baseline.window_end },
      gsc_clicks_28d: baseline.gsc_clicks_28d, gsc_impressions_28d: baseline.gsc_impressions_28d,
      gsc_avg_ctr_28d: baseline.gsc_avg_ctr_28d, gsc_avg_position_28d: baseline.gsc_avg_position_28d,
      ga4_active_users_28d: baseline.ga4_active_users_28d, ga4_sessions_28d: baseline.ga4_sessions_28d,
    }, null, 2))
    sections.push('```')
    sections.push('Quote these exact numbers in your completion receipt so the OS can line them up against the post-change window.')
  }
  sections.push('\n## Expected measurable outcome')
  sections.push('Record your post-change expectation (one primary success metric + at least one guardrail metric) in the completion receipt so the OS can measure it at D7/D14/D28/D90.')
  sections.push('**Measurement windows:** D7, D14, D28, D90 relative to the deployment date.')
  sections.push('\n## Constraints and risks')
  sections.push('- Preserve existing production functionality. Protect PokePrices SEO recovery.\n- Small, independent, reversible commits. Rollback = single `git revert`.\n- No DB migrations unless specifically justified.\n- No new paid AI dependencies.\n- Do NOT mark the action complete merely because a commit was pushed — the completion receipt must include a Vercel READY state for the correct project.')
  sections.push('\n## Completion-report format')
  sections.push('When you have finished, return a JSON block with these fields:')
  sections.push('```json')
  sections.push(JSON.stringify({
    action_id: task.id, implementation_type: '<classification>', completed_at: '<ISO>',
    repository: '<repo>', commit_sha: '<sha>', production_deployment_sha: '<sha>',
    affected_pages_or_features: ['<list>'], summary_of_what_changed: '<prose>',
    tests_performed: ['<list>'], live_verification: '<prose>', rollback_route: '<revert instr>',
    primary_success_metric: '<metric>', guardrail_metrics: ['<list>'], outstanding_issues: '<prose or null>',
  }, null, 2))
  sections.push('```')
  const prompt_text = sections.join('\n')
  const hashInput = JSON.stringify({
    v: PROMPT_VERSION, task_id: task.id, task_evidence: task.evidence,
    intel_id: intel?.id ?? null, intel_evidence: intel?.evidence ?? null,
    expected_upside: intel?.expected_upside ?? null,
    recommended_action: intel?.recommended_action ?? task.recommended_action ?? null,
    priority: task.priority, task_kind: task.task_kind, task_type: task.task_type,
    site_slug: site?.slug ?? null, baseline_frozen_at: baseline?.frozen_at ?? null,
  })
  const prompt_hash = createHash('sha256').update(hashInput).digest('hex')
  return { prompt_text, prompt_hash, prompt_version: PROMPT_VERSION, implementation_type: implType, created_at: new Date().toISOString() }
}

// ─────── Mirror of apps/hub/src/server/claude/completion-receipt.ts ────────
const MAX_STR = 4000
function isIsoTimestamp(v) { if (typeof v !== 'string') return false; const p = Date.parse(v); return Number.isFinite(p) && v.includes('-') }
function cappedString(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string') return 'TYPE_ERROR'
  const t = v.trim()
  if (t.length === 0) return null
  return t.length > MAX_STR ? t.slice(0, MAX_STR) : t
}
function validateReceipt(raw, expectedActionId) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Receipt must be a JSON object.' }
  const o = raw
  if (typeof o.action_id !== 'string' || !o.action_id.trim()) return { ok: false, error: 'action_id required', path: 'action_id' }
  if (o.action_id !== expectedActionId) return { ok: false, error: `action_id in receipt (${o.action_id}) does not match the task ID (${expectedActionId}).`, path: 'action_id' }
  if (!isIsoTimestamp(o.completed_at)) return { ok: false, error: 'completed_at must be ISO-8601', path: 'completed_at' }
  if (typeof o.summary_of_what_changed !== 'string' || !o.summary_of_what_changed.trim()) return { ok: false, error: 'summary_of_what_changed required', path: 'summary_of_what_changed' }
  const out = { action_id: o.action_id, completed_at: new Date(o.completed_at).toISOString(), summary_of_what_changed: cappedString(o.summary_of_what_changed) }
  for (const k of ['implementation_type','repository','commit_sha','production_deployment_sha','live_verification','rollback_route','primary_success_metric','outstanding_issues']) {
    if (o[k] === undefined) continue
    if (o[k] === null) { out[k] = null; continue }
    const s = cappedString(o[k])
    if (s === 'TYPE_ERROR') return { ok: false, error: `${k} must be a string, null, or omitted`, path: k }
    if (s !== null) out[k] = s
  }
  return { ok: true, value: out }
}
function parseAndValidateReceipt(raw, expectedActionId) {
  const t = (raw ?? '').trim()
  if (!t) return { ok: false, error: 'Paste is empty.' }
  const start = t.indexOf('{'), end = t.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) return { ok: false, error: 'No JSON object found in the paste.' }
  let parsed
  try { parsed = JSON.parse(t.slice(start, end + 1)) }
  catch (e) { return { ok: false, error: `Invalid JSON: ${e.message}` } }
  return validateReceipt(parsed, expectedActionId)
}

// ─────── Test fixtures ────────
async function createDisposableIntelAndTask(siteId) {
  // Use a stable dedupe_key so re-runs don't duplicate. Use a
  // low-risk category to match the brief's "existing low-risk
  // Intelligence recommendation or clearly labelled test task".
  const now = Date.now().toString(36)
  const dedupeKey = `${MARKER}-${now}`
  const { data: intel, error: intelErr } = await sb.from('network_intelligence_items').insert({
    site_id: siteId,
    category: 'content',
    type: 'test',
    signal_kind: 'opportunity',
    title: `${MARKER} disposable opportunity ${now}`,
    summary: 'Low-risk disposable test. Freeze baseline + run through the Claude Code workflow; nothing lands in production.',
    recommended_action: 'This is a test action — do not implement anything.',
    source_type: 'manual',
    source_key: dedupeKey,
    evidence: { marker: MARKER, target_url: '/insights/test-page', target_query: 'test query', note: 'disposable fixture' },
    expected_upside: { users_28d: 0, note: 'test only' },
    impact_score: 10, confidence_score: 20, urgency_score: 10, effort_score: 50, priority_score: 15,
    status: 'open',
  }).select('*').single()
  if (intelErr) throw intelErr
  const { data: task, error: taskErr } = await sb.from('network_tasks').insert({
    site_id: siteId,
    title: `${MARKER} disposable action ${now}`,
    description: `${MARKER} disposable test — intel id ${intel.id}`,
    task_type: 'intelligence',
    task_kind: 'improvement',
    task_source: 'intelligence',
    priority: 'low',
    status: 'open',
    recommended_action: intel.recommended_action,
    evidence: { intelligence_item_id: intel.id, marker: MARKER, target_url: '/insights/test-page' },
  }).select('*').single()
  if (taskErr) throw taskErr
  await sb.from('network_intelligence_items').update({ status: 'task_created', task_id: task.id }).eq('id', intel.id)
  return { intel, task }
}

// ─────── Server Action mirrors (write to metadata) ────────
async function doFreezeBaseline(taskId, { force = false } = {}) {
  const { data: task } = await sb.from('network_tasks').select('id, site_id, evidence, metadata').eq('id', taskId).single()
  const prevMeta = task.metadata ?? {}
  if (prevMeta.baseline && !force) return { outcome: 'refused_existing' }
  let siteSlug = null
  if (task.site_id) {
    const { data: s } = await sb.from('network_sites').select('slug').eq('id', task.site_id).maybeSingle()
    siteSlug = s?.slug ?? null
  }
  let intelEvidence = null
  const intelId = task.evidence?.intelligence_item_id
  if (typeof intelId === 'string') {
    const { data: iRow } = await sb.from('network_intelligence_items').select('evidence').eq('id', intelId).maybeSingle()
    intelEvidence = iRow?.evidence ?? null
  }
  const { target_url, target_query } = extractEvidenceTargets(task.evidence, intelEvidence)
  const baseline = await buildBaselineSnapshot({ siteId: task.site_id, siteSlug, evidenceTargetUrl: target_url, evidenceTargetQuery: target_query })
  const nextMeta = { ...prevMeta, baseline }
  const { error } = await sb.from('network_tasks').update({ metadata: nextMeta }).eq('id', taskId)
  if (error) throw error
  return { outcome: 'frozen', baseline }
}

async function doGeneratePrompt(taskId) {
  const { data: task } = await sb.from('network_tasks').select('*').eq('id', taskId).single()
  let site = null
  if (task.site_id) {
    const { data: s } = await sb.from('network_sites').select('slug, name, canonical_url').eq('id', task.site_id).maybeSingle()
    if (s) {
      const url = s.canonical_url ?? ''
      const domain = url.replace(/^https?:\/\//, '').replace(/\/$/, '') || null
      site = { slug: s.slug, name: s.name, domain }
    }
  }
  let intel = null
  const intelId = task.evidence?.intelligence_item_id
  if (typeof intelId === 'string') {
    const { data: iRow } = await sb.from('network_intelligence_items').select('*').eq('id', intelId).maybeSingle()
    intel = iRow ?? null
  }
  const baseline = (task.metadata ?? {}).baseline ?? null
  const built = buildClaudePrompt({ task, site, intel, baseline })
  const prevMeta = task.metadata ?? {}
  const existing = Array.isArray(prevMeta.generated_prompts) ? prevMeta.generated_prompts : []
  const alreadyThere = existing.some((p) => p?.prompt_hash === built.prompt_hash)
  if (!alreadyThere) {
    const nextList = [{
      prompt_version: built.prompt_version, prompt_hash: built.prompt_hash,
      implementation_type: built.implementation_type, created_at: built.created_at,
      prompt_text: built.prompt_text,
    }, ...existing].slice(0, 10)
    const nextMeta = { ...prevMeta, generated_prompts: nextList }
    await sb.from('network_tasks').update({ metadata: nextMeta }).eq('id', taskId)
  }
  return built
}

async function doRecordReceipt(taskId, rawPaste) {
  const { data: task } = await sb.from('network_tasks').select('id, metadata').eq('id', taskId).single()
  const prevMeta = task.metadata ?? {}
  const validation = parseAndValidateReceipt(rawPaste, taskId)
  if (!validation.ok) {
    const nextMeta = { ...prevMeta, receipt_last_error: { at: new Date().toISOString(), message: validation.error, path: validation.path } }
    await sb.from('network_tasks').update({ metadata: nextMeta }).eq('id', taskId)
    return { ok: false, error: validation.error, path: validation.path }
  }
  const stored = {
    ...validation.value, received_at: new Date().toISOString(),
    received_version: 'cn05-receipt-v1', operator_confirmed_at: null, operator_confirmed_by: null,
  }
  const existing = Array.isArray(prevMeta.implementation_receipts) ? prevMeta.implementation_receipts : []
  const next = [stored, ...existing].slice(0, 10)
  const nextMeta = { ...prevMeta, implementation_receipts: next, receipt_last_error: undefined }
  await sb.from('network_tasks').update({ metadata: nextMeta }).eq('id', taskId)
  return { ok: true, stored }
}

async function doConfirmVerified(taskId, operatorId = null) {
  const { data: task } = await sb.from('network_tasks').select('id, metadata').eq('id', taskId).single()
  const prevMeta = task.metadata ?? {}
  const receipts = Array.isArray(prevMeta.implementation_receipts) ? prevMeta.implementation_receipts : []
  if (receipts.length === 0) return { ok: false, error: 'no receipts' }
  const now = new Date().toISOString()
  const nextReceipts = receipts.map((r, i) => i === 0 ? { ...r, operator_confirmed_at: now, operator_confirmed_by: operatorId } : r)
  const nextMeta = { ...prevMeta, implementation_receipts: nextReceipts }
  await sb.from('network_tasks').update({ metadata: nextMeta, status: 'in_progress' }).eq('id', taskId)
  return { ok: true }
}

// ─────── Tests ────────
async function main() {
  section('0. Live SHA probe')
  console.log('  (we rely on the Vercel dashboard READY status for current prod SHA; see list_deployments output in final report)')

  // Pokemon has rich GSC+GA4 history → best signal baseline.
  const { data: siteRow } = await sb.from('network_sites').select('id, slug, name').eq('slug', 'pokemon').single()
  console.log(`  using site: ${siteRow.name} (${siteRow.id})`)

  let intel, task
  try {
    section('1. Intel → task linkage')
    const r = await createDisposableIntelAndTask(siteRow.id)
    intel = r.intel; task = r.task
    const { data: freshIntel } = await sb.from('network_intelligence_items').select('id, status, task_id').eq('id', intel.id).single()
    const { data: freshTask } = await sb.from('network_tasks').select('id, evidence, task_type, status').eq('id', task.id).single()
    if (freshIntel.task_id === task.id) pass('intelligence.task_id points at the task', `task_id=${task.id.slice(0,8)}…`)
    else fail('intel.task_id linkage', new Error(`task_id=${freshIntel.task_id}`))
    if (freshIntel.status === 'task_created') pass('intelligence.status flipped to task_created')
    else fail('intel.status', new Error(freshIntel.status))
    if (freshTask.evidence?.intelligence_item_id === intel.id) pass('task.evidence.intelligence_item_id points back at the intel item')
    else fail('task→intel back-reference', new Error(JSON.stringify(freshTask.evidence)))
    if (freshTask.task_type === 'intelligence' && freshTask.status === 'open') pass('task entered task_type=intelligence, status=open')
    else fail('task shape', new Error(`type=${freshTask.task_type} status=${freshTask.status}`))

    section('2. Task detail (metadata reachable with service-role read)')
    const { data: detail, error: detailErr } = await sb.from('network_tasks').select('id, title, description, priority, status, site_id, task_type, task_kind, task_source, evidence, metadata, recommended_action').eq('id', task.id).maybeSingle()
    if (!detailErr && detail && detail.title === task.title) pass('task detail selectable', `title="${detail.title.slice(0,40)}…"`)
    else fail('task detail selectable', detailErr ?? new Error('row missing'))

    section('3. Freeze baseline captures the completed GSC+GA4 window')
    const r3 = await doFreezeBaseline(task.id)
    if (r3.outcome !== 'frozen') { fail('freeze outcome', new Error(r3.outcome)); return }
    const b = r3.baseline
    pass('baseline frozen', `${b.window_start}→${b.window_end}  gsc_clicks=${b.gsc_clicks_28d}  gsc_imps=${b.gsc_impressions_28d}  ga4_users=${b.ga4_active_users_28d}`)
    // Window must END on a historical date (not in the future, not today)
    const todayIso = new Date().toISOString().slice(0, 10)
    if (b.window_end && b.window_end < todayIso) pass('baseline window ends on a historical date', `end=${b.window_end} today=${todayIso}`)
    else fail('baseline window ends historical', new Error(`end=${b.window_end} today=${todayIso}`))
    // 28-day span
    if (b.window_start && b.window_end) {
      const span = (Date.parse(b.window_end) - Date.parse(b.window_start)) / 86400000
      if (span >= 27 && span <= 28) pass('baseline covers 28-day span', `${span}d`)
      else fail('baseline window span', new Error(`${span}d`))
    }
    if (b.target_url === '/insights/test-page') pass('target_url pulled from task evidence')
    else fail('target_url extraction', new Error(`got=${b.target_url}`))
    if (b.target_query === 'test query') pass('target_query pulled from intel evidence')
    else fail('target_query extraction', new Error(`got=${b.target_query}`))
    if (b.frozen_version === 'cn05-baseline-v1') pass('baseline version stamped')
    else fail('baseline version', new Error(b.frozen_version))
    const expectedCtr = b.gsc_impressions_28d > 0 ? b.gsc_clicks_28d / b.gsc_impressions_28d : null
    if (Math.abs((b.gsc_avg_ctr_28d ?? 0) - (expectedCtr ?? 0)) < 1e-9) pass('derived CTR matches clicks/impressions')
    else fail('derived CTR', new Error(`got=${b.gsc_avg_ctr_28d} expected=${expectedCtr}`))

    section('4. Baseline immutability — second freeze without force is refused')
    const originalFrozenAt = b.frozen_at
    const r4 = await doFreezeBaseline(task.id)  // no force
    if (r4.outcome === 'refused_existing') pass('freezeBaselineAction refuses to overwrite existing baseline without force=1')
    else fail('baseline immutability', new Error(`outcome=${r4.outcome}`))
    const { data: afterSecond } = await sb.from('network_tasks').select('metadata').eq('id', task.id).single()
    if (afterSecond.metadata.baseline.frozen_at === originalFrozenAt) pass('metadata.baseline unchanged after refused freeze')
    else fail('baseline unchanged', new Error('frozen_at changed'))
    // force=1 does rewrite
    const r4b = await doFreezeBaseline(task.id, { force: true })
    if (r4b.outcome === 'frozen' && r4b.baseline.frozen_at !== originalFrozenAt) pass('force=1 permits an explicit re-freeze')
    else fail('force=1 re-freeze', new Error(`outcome=${r4b.outcome}`))

    section('5. Generate Claude Code prompt — contains all mandatory sections')
    const built = await doGeneratePrompt(task.id)
    const checks = [
      ['contains action ID', built.prompt_text.includes(`**Action ID:** \`${task.id}\``)],
      ['contains site', built.prompt_text.includes('pokemon')],
      ['contains evidence JSON block', built.prompt_text.includes('"intelligence_item_id"') || built.prompt_text.includes('"target_url"')],
      ['contains frozen baseline section', built.prompt_text.includes('## Frozen baseline')],
      ['includes baseline target_url', built.prompt_text.includes('`/insights/test-page`')],
      ['includes baseline target_query', built.prompt_text.includes('`test query`')],
      ['includes baseline window', built.prompt_text.includes('Window:')],
      ['safeguard: no DB migrations unless justified', /no db migrations/i.test(built.prompt_text)],
      ['safeguard: PokePrices SEO recovery', built.prompt_text.includes('PokePrices SEO recovery')],
      ['safeguard: no new paid AI deps', /no new paid ai/i.test(built.prompt_text)],
      ['safeguard: no cert-on-commit', /must include a Vercel READY state/.test(built.prompt_text)],
      ['reporting instruction: completion-report format', built.prompt_text.includes('## Completion-report format')],
      ['reporting instruction: D7/D14/D28/D90 windows', /D7\/D14\/D28\/D90|D7, D14, D28, D90/.test(built.prompt_text)],
      ['completion-report action_id matches task', built.prompt_text.includes(`"action_id": "${task.id}"`)],
    ]
    for (const [n, ok] of checks) { if (ok) pass(n); else fail(n, new Error('fragment missing')) }

    section('6. Prompt copyable + version/hash recorded')
    const { data: afterGen } = await sb.from('network_tasks').select('metadata').eq('id', task.id).single()
    const stored = afterGen.metadata.generated_prompts?.[0]
    if (stored && stored.prompt_text === built.prompt_text) pass('generated prompt stored verbatim', `${stored.prompt_text.length} chars`)
    else fail('stored prompt_text matches', new Error('mismatch'))
    if (stored && typeof stored.prompt_hash === 'string' && stored.prompt_hash.length === 64) pass('stored prompt_hash is sha256', stored.prompt_hash.slice(0, 12) + '…')
    else fail('stored prompt_hash', new Error(stored?.prompt_hash))
    if (stored?.prompt_version === 'cn05-action-prompt-v1') pass('stored prompt_version is current', stored.prompt_version)
    else fail('stored prompt_version', new Error(stored?.prompt_version))
    // Re-run generate — hash should be identical (deterministic) and no duplicate written
    const built2 = await doGeneratePrompt(task.id)
    const { data: afterGen2 } = await sb.from('network_tasks').select('metadata').eq('id', task.id).single()
    const prompts = afterGen2.metadata.generated_prompts ?? []
    if (built2.prompt_hash === built.prompt_hash && prompts.length === 1) pass('idempotent regenerate — same hash, no duplicate in history', `prompts=${prompts.length}`)
    else fail('idempotent regenerate', new Error(`hash_match=${built2.prompt_hash === built.prompt_hash} prompts=${prompts.length}`))

    section('7. Record a valid implementation receipt')
    const receipt = {
      action_id: task.id,
      implementation_type: 'investigation',
      completed_at: new Date().toISOString(),
      repository: 'collector-network',
      commit_sha: '0000000000000000000000000000000000000000',
      production_deployment_sha: null,
      affected_pages_or_features: [`${MARKER} test — no production impact`],
      summary_of_what_changed: `${MARKER} end-to-end verification — no code shipped from this receipt.`,
      tests_performed: ['CN-05 Intel E2E harness assertions'],
      live_verification: 'n/a (test receipt)',
      rollback_route: 'n/a — nothing shipped',
      primary_success_metric: 'none (test)',
      guardrail_metrics: ['no production content touched'],
      outstanding_issues: null,
    }
    const r7 = await doRecordReceipt(task.id, JSON.stringify(receipt))
    if (r7.ok) pass('valid receipt accepted')
    else fail('valid receipt accepted', new Error(r7.error))
    const { data: afterReceipt } = await sb.from('network_tasks').select('metadata').eq('id', task.id).single()
    const stored7 = afterReceipt.metadata.implementation_receipts?.[0]
    if (stored7?.action_id === task.id && stored7?.summary_of_what_changed === receipt.summary_of_what_changed) pass('receipt stored in metadata')
    else fail('receipt storage', new Error(JSON.stringify(stored7)))

    section('8. Incorrect task IDs + malformed receipts are rejected')
    // Wrong action_id
    const wrongId = { ...receipt, action_id: '00000000-0000-0000-0000-000000000000' }
    const r8a = await doRecordReceipt(task.id, JSON.stringify(wrongId))
    if (!r8a.ok && r8a.path === 'action_id') pass('mismatched action_id rejected', r8a.error.slice(0, 60) + '…')
    else fail('mismatched action_id rejected', new Error(JSON.stringify(r8a)))
    // Confirm the rejected receipt did NOT overwrite the valid one
    const { data: afterR8a } = await sb.from('network_tasks').select('metadata').eq('id', task.id).single()
    const stillValid = afterR8a.metadata.implementation_receipts?.[0]
    if (stillValid?.summary_of_what_changed === receipt.summary_of_what_changed) pass('prior valid receipt preserved after rejection')
    else fail('valid receipt preserved', new Error('clobbered'))
    if (afterR8a.metadata.receipt_last_error && afterR8a.metadata.receipt_last_error.path === 'action_id') pass('receipt_last_error recorded with path hint')
    else fail('receipt_last_error', new Error(JSON.stringify(afterR8a.metadata.receipt_last_error)))
    // Malformed JSON
    const r8b = await doRecordReceipt(task.id, 'this is not JSON { broken')
    if (!r8b.ok) pass('malformed JSON rejected', r8b.error.slice(0, 60) + '…')
    else fail('malformed JSON rejected', new Error('unexpected ok'))
    // Missing required field
    const r8c = await doRecordReceipt(task.id, JSON.stringify({ action_id: task.id, completed_at: new Date().toISOString() }))
    if (!r8c.ok && r8c.path === 'summary_of_what_changed') pass('missing summary rejected', r8c.error.slice(0, 60) + '…')
    else fail('missing summary rejected', new Error(JSON.stringify(r8c)))
    // Bad timestamp
    const r8d = await doRecordReceipt(task.id, JSON.stringify({ action_id: task.id, completed_at: 'tomorrow', summary_of_what_changed: 'x' }))
    if (!r8d.ok && r8d.path === 'completed_at') pass('bad timestamp rejected', r8d.error.slice(0, 60) + '…')
    else fail('bad timestamp rejected', new Error(JSON.stringify(r8d)))

    section('9. Receipt does NOT auto-certify production verification')
    const { data: afterRecordAll } = await sb.from('network_tasks').select('status, metadata').eq('id', task.id).single()
    const latestReceipt = afterRecordAll.metadata.implementation_receipts?.[0]
    if (latestReceipt?.operator_confirmed_at == null) pass('operator_confirmed_at remains null — receipt is NOT self-certifying')
    else fail('operator_confirmed_at null before verification', new Error(latestReceipt.operator_confirmed_at))
    if (afterRecordAll.status === 'open') pass('task status remains "open" after receipt paste (not promoted)')
    else fail('task status unchanged', new Error(afterRecordAll.status))

    section('10. Operator verification records confirmation + updates task')
    const r10 = await doConfirmVerified(task.id, null)
    if (r10.ok) pass('confirm action succeeded')
    else fail('confirm action', new Error(r10.error))
    const { data: afterConfirm } = await sb.from('network_tasks').select('status, metadata').eq('id', task.id).single()
    const confirmed = afterConfirm.metadata.implementation_receipts?.[0]
    if (confirmed?.operator_confirmed_at && new Date(confirmed.operator_confirmed_at) <= new Date()) pass('receipt.operator_confirmed_at set to a server timestamp')
    else fail('operator_confirmed_at set', new Error(confirmed?.operator_confirmed_at))
    if (afterConfirm.status === 'in_progress') pass('task status promoted open → in_progress on operator verify')
    else fail('task status promoted', new Error(afterConfirm.status))

    section('11. Baseline + prompt history + receipt history all still accessible')
    const { data: finalRow } = await sb.from('network_tasks').select('metadata').eq('id', task.id).single()
    const meta = finalRow.metadata
    if (meta.baseline && meta.baseline.frozen_version === 'cn05-baseline-v1') pass('baseline preserved + readable')
    else fail('baseline preserved', new Error(JSON.stringify(meta.baseline)))
    if (Array.isArray(meta.generated_prompts) && meta.generated_prompts.length >= 1 && typeof meta.generated_prompts[0].prompt_text === 'string') pass(`prompt history preserved (${meta.generated_prompts.length} entries)`)
    else fail('prompt history', new Error('missing'))
    if (Array.isArray(meta.implementation_receipts) && meta.implementation_receipts.length >= 1) pass(`implementation receipts preserved (${meta.implementation_receipts.length} entries)`)
    else fail('receipts history', new Error('missing'))

  } finally {
    section('12. Cleanup')
    // Catch everything matching the marker, in case prior runs orphaned anything.
    const { data: strayIntel } = await sb.from('network_intelligence_items').select('id, task_id').like('title', `${MARKER}%`)
    const { data: strayTasks } = await sb.from('network_tasks').select('id').like('title', `${MARKER}%`)
    const intelIds = (strayIntel ?? []).map((r) => r.id)
    const taskIds = (strayTasks ?? []).map((r) => r.id)
    if (intelIds.length) await sb.from('network_intelligence_items').update({ task_id: null }).in('id', intelIds)
    if (taskIds.length) await sb.from('network_tasks').delete().in('id', taskIds)
    if (intelIds.length) await sb.from('network_intelligence_items').delete().in('id', intelIds)
    pass(`cleaned ${intelIds.length} intel row(s) + ${taskIds.length} task row(s)`)
  }

  console.log('\n━━━ SUMMARY ━━━')
  const passCount = results.filter((r) => r.status === 'PASS').length
  const failCount = results.filter((r) => r.status === 'FAIL').length
  console.log(`${passCount} PASS, ${failCount} FAIL`)
  if (failCount > 0) {
    console.log('\nFailures:')
    for (const r of results.filter((r) => r.status === 'FAIL')) console.log(`  ✗ ${r.name} — ${r.err}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1) })
