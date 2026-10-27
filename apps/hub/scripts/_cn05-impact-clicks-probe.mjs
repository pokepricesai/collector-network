#!/usr/bin/env node
// scripts/_cn05-impact-clicks-probe.mjs
//
// CN-05 Sprint 7 Task 1b — attempt real Impact attribution evidence.
//
// Queries Impact's Media Partner API for recent click activity under
// our account (SID = IMPACT_ACCOUNT_SID). Reports:
//   * Whether API credentials work.
//   * Any clicks recorded in the last 30 days.
//   * SubID / SharedID distribution if present.
//
// If no clicks have arrived yet (expected: our launch is < 24h old
// and real-user clicks are unlikely to have landed), the script
// reports zero and surfaces exactly what dashboard evidence is still
// required.
//
// Read-only. Uses GET /Mediapartners/{sid}/Actions and
// /Reports endpoints.

import '../../../scripts/_lib/load-env.mjs'

const sid = (process.env.IMPACT_ACCOUNT_SID ?? '').trim()
const tok = (process.env.IMPACT_API_TOKEN ?? '').trim()
if (!sid || !tok) {
  console.error('IMPACT_ACCOUNT_SID or IMPACT_API_TOKEN not configured in env.')
  console.error('Expected location: apps/hub/.env.local or pokeprices-web/.env.local')
  process.exit(2)
}

const AUTH = `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}`
const BASE = 'https://api.impact.com'

async function get(path, search) {
  const url = new URL(`${BASE}/Mediapartners/${encodeURIComponent(sid)}${path}`)
  if (search) for (const [k, v] of Object.entries(search)) url.searchParams.set(k, String(v))
  url.searchParams.set('output', 'json')
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      'User-Agent': 'cn05-sprint7-probe/1.0',
    },
  })
  const text = await r.text()
  const excerpt = text.length > 1600 ? text.slice(0, 1600) + '…' : text
  let data = null
  try { data = JSON.parse(text) } catch { /* keep raw */ }
  return { status: r.status, ok: r.ok, data, excerpt, url: url.toString() }
}

async function main() {
  console.log('\nCN-05 Sprint 7 — Impact attribution probe')
  console.log('==========================================')
  console.log(`Account SID (prefix): ${sid.slice(0, 6)}…`)

  // 1. Sanity: /Programs — lists programs we are enrolled in.
  const programs = await get('/Programs')
  console.log(`\n[1] GET /Programs → status=${programs.status}`)
  if (!programs.ok) {
    console.log(`  excerpt: ${programs.excerpt.slice(0, 400)}`)
    process.exit(0)
  }
  const programList = programs.data?.Programs ?? []
  console.log(`  programs enrolled: ${programList.length}`)
  for (const p of programList.slice(0, 10)) {
    console.log(`    • ${p.Name ?? '-'} (CampaignId ${p.CampaignId ?? p.Id ?? '-'})`)
  }

  // 2. Click-level actions report. The endpoint name differs across
  //    Impact's docs; try the standard "Actions" collection first.
  //    Narrow to the last 7 days.
  const nowIso = new Date().toISOString()
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const actions = await get('/Actions', {
    StartDate: sevenDaysAgoIso.slice(0, 10),
    EndDate: nowIso.slice(0, 10),
    PageSize: 50,
  })
  console.log(`\n[2] GET /Actions (last 7 days) → status=${actions.status}`)
  if (!actions.ok) {
    console.log(`  excerpt: ${actions.excerpt.slice(0, 400)}`)
  } else {
    const actionList = actions.data?.Actions ?? []
    console.log(`  actions in window: ${actionList.length}`)
    for (const a of actionList.slice(0, 5)) {
      console.log(
        `    • ${a.ActionDate ?? '-'} type=${a.ActionType ?? a.State ?? '-'} ` +
          `shared=${a.SubId1 ?? a.SharedId ?? '-'} payout=${a.Payout ?? '-'}`,
      )
    }
  }

  // 3. Try the Reports collection — the Shared ID report, if available.
  //    Different Impact tenants expose different report IDs; we try the
  //    universal "mp_action_listing_sr" and surface what we get.
  const sharedId = await get('/Reports/mp_action_listing_sr', {
    START_DATE: sevenDaysAgoIso.slice(0, 10),
    END_DATE: nowIso.slice(0, 10),
    PageSize: 50,
  })
  console.log(`\n[3] GET /Reports/mp_action_listing_sr → status=${sharedId.status}`)
  if (!sharedId.ok) {
    console.log(`  excerpt: ${sharedId.excerpt.slice(0, 400)}`)
  } else {
    const records = sharedId.data?.Records ?? sharedId.data?.Records_data ?? []
    console.log(`  records: ${Array.isArray(records) ? records.length : 'unknown-shape'}`)
    if (Array.isArray(records)) {
      for (const r of records.slice(0, 5)) {
        console.log(`    • ${JSON.stringify(r).slice(0, 220)}`)
      }
    } else if (sharedId.data) {
      console.log(`  response keys: ${Object.keys(sharedId.data).join(', ')}`)
    }
  }

  console.log('')
}

main().catch((e) => { console.error(e); process.exit(1) })
