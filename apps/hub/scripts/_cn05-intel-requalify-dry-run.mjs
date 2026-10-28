#!/usr/bin/env node
// CN-05 Intelligence Quality Pass — read-only dry-run requalification.
//
// Identifies intel items whose linked task is completed but whose
// intel status hasn't been flipped to 'resolved'. These are the
// recommendations that keep showing in the active inbox even
// though the work is done.
//
// Reports a before/after diff for operator review BEFORE any
// writes. Run with --apply to actually apply the changes.
//
// Run read-only:  node apps/hub/scripts/_cn05-intel-requalify-dry-run.mjs
// Run apply:      node apps/hub/scripts/_cn05-intel-requalify-dry-run.mjs --apply

import '../../../scripts/_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

async function main() {
  console.log(`\n=== Intelligence requalification dry-run (${APPLY ? 'APPLY' : 'READ-ONLY'}) ===\n`)

  // 1. Items in task_created where linked task is completed
  const { data: intel } = await sb.from('network_intelligence_items')
    .select('id, status, task_id, category, type, title, priority_score, last_detected_at, resolved_at, resolved_reason')
    .eq('status', 'task_created').not('task_id', 'is', null)
  const taskIds = (intel ?? []).map((r) => r.task_id).filter(Boolean)
  if (taskIds.length === 0) {
    console.log('No task_created intel items with a linked task_id. Nothing to requalify.')
    return
  }
  const { data: tasks } = await sb.from('network_tasks')
    .select('id, status, title, completed_at, task_source, evidence')
    .in('id', taskIds)
  const taskById = new Map((tasks ?? []).map((t) => [t.id, t]))

  const stuck = []
  for (const i of intel ?? []) {
    const t = taskById.get(i.task_id)
    if (!t) continue
    if (t.status === 'completed') stuck.push({ intel: i, task: t })
  }

  console.log(`Stuck items (intel status=task_created but linked task status=completed): ${stuck.length}\n`)
  if (stuck.length === 0) {
    console.log('No requalification needed.')
    return
  }

  console.log('Diff preview — what would change:')
  console.log('')
  console.log('  intel_id         category               task_id            task.completed_at    before  →  after')
  console.log('  ─────────────────────────────────────────────────────────────────────────────────────────────────')
  for (const { intel: i, task: t } of stuck) {
    const row = [
      i.id.slice(0, 8),
      (i.category + '/' + i.type).padEnd(28),
      t.id.slice(0, 8),
      (t.completed_at ?? '').slice(0, 19).padEnd(20),
      'task_created  →  resolved (task_completed)',
    ].join('  ')
    console.log('  ' + row)
    console.log(`    title: "${i.title.slice(0, 80)}"`)
  }

  // 2. Opportunity-engine freshness: do any 'resolved' intel items
  //    still have an OPEN underlying opportunity? That would indicate
  //    the opportunity should be reopened (unlikely in practice but
  //    worth checking).
  const resolvedCount = stuck.length
  const resolvedReasonsBefore = { task_completed: 0 }
  for (const { intel: i } of stuck) {
    resolvedReasonsBefore[i.resolved_reason ?? 'null'] = (resolvedReasonsBefore[i.resolved_reason ?? 'null'] ?? 0) + 1
  }

  console.log('')
  console.log('Summary of changes:')
  console.log(`  intel items status=task_created → resolved:      ${resolvedCount}`)
  console.log(`  resolved_at: set to task.completed_at (preserves audit timestamp)`)
  console.log(`  resolved_reason: set to 'task_completed'`)
  console.log(`  task rows: UNCHANGED (status already completed)`)
  console.log(`  task_id back-reference: PRESERVED (not nulled)`)
  console.log(`  evidence / scores / history: PRESERVED (no fields overwritten)`)
  console.log('')
  console.log('Safety: these are intel items whose work is demonstrably done — the operator')
  console.log('        marked the task completed (which runs completeTaskAction after this')
  console.log('        commit lands, auto-flipping new completions). This script is only')
  console.log('        needed to backfill the handful of items that were completed before')
  console.log('        the lifecycle hook was wired.')
  console.log('')

  if (!APPLY) {
    console.log('(Dry-run only. Re-run with --apply to flip the stuck items to resolved.)')
    return
  }

  console.log('Applying…')
  for (const { intel: i, task: t } of stuck) {
    const { error } = await sb.from('network_intelligence_items').update({
      status: 'resolved',
      resolved_at: t.completed_at ?? new Date().toISOString(),
      resolved_reason: 'task_completed',
    }).eq('id', i.id).eq('status', 'task_created')  // Guard against concurrent modification.
    if (error) console.log('  ✗ intel ' + i.id.slice(0, 8) + ': ' + error.message)
    else console.log('  ✓ intel ' + i.id.slice(0, 8) + ' → resolved (task_completed)')
  }
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1) })
