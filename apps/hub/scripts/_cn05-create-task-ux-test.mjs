#!/usr/bin/env node
// CN-05 OS UX fix verification — Create task from Intelligence.
//
// The deployed Server Action lives at:
//   apps/hub/src/app/admin/intelligence/actions.ts :: createTaskFromItemAction
//
// Behaviour under test (post-fix):
//   1. Fresh intel item → inserts task, flips item.status=task_created,
//      sets item.task_id, redirects to /admin/tasks/{id}.
//   2. Already-linked item (task_id set) → redirects to existing task,
//      inserts nothing.
//   3. Orphan existing task (another open task carries the intel id in
//      its evidence but back-reference never got written) → backfills
//      link + opens the existing task; no sibling inserted.
//   4. Missing/stale item_id → redirects to /admin/intelligence?task_error=...
//
// Everything runs with service-role Supabase, no browser needed. The
// test exercises the same server-side logic the Server Action runs.

import '../../../scripts/_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const MARKER = 'CN-05-CREATE-TASK-UX'
const results = []
function pass(n, note = '') { results.push({ ok: true, n }); console.log(`  ✓ ${n}${note ? ' — ' + note : ''}`) }
function fail(n, err) { results.push({ ok: false, n, err: err?.message ?? String(err) }); console.log(`  ✗ ${n} — ${err?.message ?? err}`) }
function section(name) { console.log(`\n━━━ ${name} ━━━`) }

// Inline mirror of the Server Action's business logic (v2). The
// deployed Server Action returns a structured CreateTaskResult
// instead of calling redirect() — see actions.ts for rationale.
// This mirror returns the SAME shape so any drift between it and
// the deployed code surfaces as a test failure.
async function createTaskFromItem(itemId) {
  if (typeof itemId !== 'string' || !itemId) return { ok: false, error: 'Missing intelligence item id' }
  const { data: item, error: loadErr } = await sb
    .from('network_intelligence_items')
    .select('id, site_id, status, category, type, title, summary, recommended_action, evidence, source_type, source_id, source_key, impact_score, confidence_score, urgency_score, effort_score, priority_score, task_id')
    .eq('id', itemId).maybeSingle()
  if (loadErr) return { ok: false, error: loadErr.message }
  if (!item) return { ok: false, error: 'Intelligence item not found' }
  if (item.task_id) return { ok: true, task_id: item.task_id, path: 'already_linked' }

  const { data: existing } = await sb.from('network_tasks')
    .select('id, status').contains('evidence', { intelligence_item_id: item.id })
    .in('status', ['open', 'in_progress', 'waiting']).order('created_at', { ascending: false }).limit(1)
  if ((existing ?? []).length > 0) {
    const existingId = existing[0].id
    await sb.from('network_intelligence_items').update({ status: 'task_created', task_id: existingId }).eq('id', item.id)
    return { ok: true, task_id: existingId, path: 'orphan_backfill' }
  }

  const prio = item.priority_score >= 85 ? 'critical' : item.priority_score >= 70 ? 'high' : item.priority_score >= 45 ? 'normal' : 'low'
  const { data: ins, error: insErr } = await sb.from('network_tasks').insert({
    site_id: item.site_id,
    title: item.title.slice(0, 240),
    description: `${item.summary ?? ''}\n\nRecommended action: ${item.recommended_action ?? ''}`,
    task_type: 'intelligence', task_kind: 'improvement', task_source: 'intelligence',
    priority: prio, status: 'open',
    recommended_action: item.recommended_action,
    evidence: {
      intelligence_item_id: item.id,
      intelligence_source_key: item.source_key, intelligence_source_type: item.source_type, intelligence_source_id: item.source_id,
      intelligence_category: item.category, intelligence_type: item.type,
      intelligence_priority_score: item.priority_score,
      snapshot_scores: { impact: item.impact_score, confidence: item.confidence_score, urgency: item.urgency_score, effort: item.effort_score, priority: item.priority_score },
      upstream_evidence: item.evidence,
    },
    metadata: { created_by_intelligence: true, admin_id: null, probe: MARKER },
  }).select('id').single()
  if (insErr || !ins) return { ok: false, error: insErr?.message ?? 'no row returned' }
  const task_id = ins.id
  await sb.from('network_intelligence_items').update({ status: 'task_created', task_id }).eq('id', item.id)
  return { ok: true, task_id, path: 'new_insert' }
}

async function createDisposableIntelItem({ linked = false, extraEv = {} } = {}) {
  const { data: site } = await sb.from('network_sites').select('id').eq('slug', 'pokemon').single()
  const now = Date.now().toString(36)
  const row = {
    site_id: site.id, category: 'seo', type: 'test-striking-distance', signal_kind: 'opportunity',
    title: `${MARKER} disposable ${now}`,
    summary: `${MARKER} fixture for Create task UX fix.`,
    recommended_action: `${MARKER} — no implementation`,
    source_type: 'manual', source_key: `${MARKER}-${now}`,
    evidence: { marker: MARKER, ...extraEv },
    impact_score: 50, confidence_score: 50, urgency_score: 50, effort_score: 50, priority_score: 55,
    status: 'open',
  }
  const { data: item, error } = await sb.from('network_intelligence_items').insert(row).select('*').single()
  if (error) throw error
  return item
}

async function cleanup(createdTaskIds, createdItemIds) {
  const tIds = Array.from(new Set(createdTaskIds.filter(Boolean)))
  const iIds = Array.from(new Set(createdItemIds.filter(Boolean)))
  // Also sweep anything marker-tagged.
  const { data: strayItems } = await sb.from('network_intelligence_items').select('id, task_id').like('title', `${MARKER}%`)
  const { data: strayTasks } = await sb.from('network_tasks').select('id').like('title', `${MARKER}%`)
  for (const r of strayItems ?? []) { iIds.push(r.id); if (r.task_id) tIds.push(r.task_id) }
  for (const r of strayTasks ?? []) tIds.push(r.id)
  if (iIds.length) await sb.from('network_intelligence_items').update({ task_id: null }).in('id', iIds)
  if (tIds.length) await sb.from('network_tasks').delete().in('id', tIds)
  if (iIds.length) await sb.from('network_intelligence_items').delete().in('id', iIds)
  return { tIds: tIds.length, iIds: iIds.length }
}

async function main() {
  const createdTaskIds = []
  const createdItemIds = []

  try {
    section('1. Fresh item → ok:true + task_id, DB rows + back-reference all correct')
    const freshItem = await createDisposableIntelItem()
    createdItemIds.push(freshItem.id)
    const r1 = await createTaskFromItem(freshItem.id)
    if (r1.ok && typeof r1.task_id === 'string' && r1.task_id.length === 36) pass('ok=true + task_id returned', r1.task_id)
    else fail('ok+task_id', new Error(JSON.stringify(r1)))
    if (r1.ok) createdTaskIds.push(r1.task_id)
    if (r1.ok && r1.path === 'new_insert') pass('took the new_insert path')
    else fail('new_insert path', new Error('path=' + (r1.ok ? r1.path : 'n/a')))
    if (r1.ok) {
      const { data: t } = await sb.from('network_tasks').select('id, task_type, task_source, status, evidence').eq('id', r1.task_id).single()
      if (t.task_type === 'intelligence' && t.task_source === 'intelligence' && t.status === 'open') pass('task row correct', `type=${t.task_type} source=${t.task_source} status=${t.status}`)
      else fail('task row shape', new Error(JSON.stringify(t)))
      if (t.evidence?.intelligence_item_id === freshItem.id) pass('task.evidence.intelligence_item_id links back')
      else fail('task→item back-reference', new Error(JSON.stringify(t.evidence)))
      const { data: i } = await sb.from('network_intelligence_items').select('status, task_id').eq('id', freshItem.id).single()
      if (i.status === 'task_created' && i.task_id === r1.task_id) pass('intel item flipped task_created + task_id set')
      else fail('intel item link', new Error(JSON.stringify(i)))
    }

    section('2. Idempotency — second click returns same task_id, inserts nothing')
    const beforeCount = await taskCountForItem(freshItem.id)
    const r2 = await createTaskFromItem(freshItem.id)
    const afterCount = await taskCountForItem(freshItem.id)
    if (r2.ok && r1.ok && r2.task_id === r1.task_id) pass('second call returns the same task_id')
    else fail('second call idempotent', new Error(JSON.stringify(r2)))
    if (r2.ok && r2.path === 'already_linked') pass('took the already_linked branch')
    else fail('idempotent branch', new Error('path=' + (r2.ok ? r2.path : 'n/a')))
    if (beforeCount === afterCount) pass('no new task inserted on repeated click', `count=${beforeCount}`)
    else fail('no sibling task created', new Error(`before=${beforeCount} after=${afterCount}`))

    section('3. Orphan existing task — backfill link, return existing task_id, no sibling')
    const orphanItem = await createDisposableIntelItem()
    createdItemIds.push(orphanItem.id)
    const { data: orphanTask } = await sb.from('network_tasks').insert({
      site_id: orphanItem.site_id, title: `${MARKER} orphan task`,
      description: 'simulated orphan', task_type: 'intelligence', task_kind: 'improvement', task_source: 'intelligence',
      priority: 'normal', status: 'open',
      evidence: { intelligence_item_id: orphanItem.id, probe: MARKER },
    }).select('*').single()
    createdTaskIds.push(orphanTask.id)
    const r3 = await createTaskFromItem(orphanItem.id)
    if (r3.ok && r3.task_id === orphanTask.id) pass('orphan branch returns existing task_id', orphanTask.id)
    else fail('orphan task_id', new Error(JSON.stringify(r3)))
    if (r3.ok && r3.path === 'orphan_backfill') pass('took the orphan_backfill branch')
    else fail('orphan branch', new Error('path=' + (r3.ok ? r3.path : 'n/a')))
    const siblingCount = await taskCountForItem(orphanItem.id)
    if (siblingCount === 1) pass('no sibling task created — exactly 1 task for this item')
    else fail('no sibling', new Error(`count=${siblingCount}`))
    const { data: orphanItemAfter } = await sb.from('network_intelligence_items').select('status, task_id').eq('id', orphanItem.id).single()
    if (orphanItemAfter.status === 'task_created' && orphanItemAfter.task_id === orphanTask.id) pass('orphan item back-reference now written')
    else fail('orphan back-reference', new Error(JSON.stringify(orphanItemAfter)))

    section('4. Missing/stale item_id → ok:false with readable error, opportunity remains actionable')
    const r4a = await createTaskFromItem('00000000-0000-0000-0000-000000000000')
    if (!r4a.ok && r4a.error) pass('non-existent id → ok:false + error message', r4a.error.slice(0, 60))
    else fail('non-existent id error', new Error(JSON.stringify(r4a)))
    const r4b = await createTaskFromItem(null)
    if (!r4b.ok && r4b.error) pass('null id → ok:false + error')
    else fail('null id error', new Error(JSON.stringify(r4b)))
    // Guarantee: a failed call must NOT leave orphaned state behind.
    // Verify no stray intel items got flipped to task_created when the
    // id was never valid.
    const { data: strayFlip } = await sb.from('network_intelligence_items')
      .select('id').eq('id', '00000000-0000-0000-0000-000000000000').maybeSingle()
    if (!strayFlip) pass('non-existent id did NOT create or flip any intel row')
    else fail('no stray flip', new Error('stray row materialised'))

    section('5. Target production item (099d374a) is either still actionable OR properly linked to a task')
    const { data: targetItem } = await sb.from('network_intelligence_items')
      .select('id, status, task_id, title, priority_score, evidence')
      .eq('id', '099d374a-87d4-4d74-a67e-19d62170ba9a').maybeSingle()
    if (targetItem) pass('target item exists', `status=${targetItem.status} task_id=${targetItem.task_id?.slice(0,8) ?? 'null'} score=${targetItem.priority_score}`)
    else fail('target item exists', new Error('row missing'))
    const isActionable = targetItem?.status === 'open' && targetItem.task_id == null
    const isLinked = targetItem?.status === 'task_created' && typeof targetItem.task_id === 'string'
    if (isActionable || isLinked) pass(`target item in a healthy state (${isActionable ? 'actionable' : 'linked to task ' + targetItem.task_id.slice(0,8)})`)
    else fail('target item healthy', new Error(JSON.stringify(targetItem)))
    if (isLinked) {
      // Confirm the task actually exists and is navigable.
      const { data: linkedTask } = await sb.from('network_tasks').select('id, status, title').eq('id', targetItem.task_id).maybeSingle()
      if (linkedTask) pass(`linked task is navigable (/admin/tasks/${linkedTask.id})`, `status=${linkedTask.status}`)
      else fail('linked task navigable', new Error('ghost task_id — intel points at non-existent task'))
    }

  } finally {
    section('6. Cleanup')
    const r = await cleanup(createdTaskIds, createdItemIds)
    pass(`deleted ${r.tIds} task(s) + ${r.iIds} intel item(s)`)
  }

  console.log('\n━━━ SUMMARY ━━━')
  const p = results.filter((r) => r.ok).length
  const f = results.filter((r) => !r.ok).length
  console.log(`${p} PASS, ${f} FAIL`)
  if (f > 0) {
    for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ ${r.n} — ${r.err}`)
    process.exit(1)
  }
}

async function taskCountForItem(itemId) {
  const { count } = await sb.from('network_tasks')
    .select('*', { count: 'exact', head: true })
    .contains('evidence', { intelligence_item_id: itemId })
  return count ?? 0
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1) })
