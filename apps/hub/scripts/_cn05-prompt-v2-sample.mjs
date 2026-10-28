#!/usr/bin/env node
// Prints the actual v2 prompt output for the Newmarket + Charizard
// fixtures. Used in the delivery report to show the before/after.

import { buildClaudePrompt } from '../src/server/claude/action-prompt.ts'

const now = new Date('2026-11-05T00:00:00Z')

function charizard() {
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
        ctr: 0, query_count: 14,
        top_queries: [
          { query: 'first edition charizard psa 10', impressions: 342, clicks: 0, position: 10.6 },
          { query: '1st edition charizard psa 10', impressions: 310, clicks: 0, position: 9.44 },
          { query: '1st edition charizard price', impressions: 240, clicks: 0, position: 9.0 },
        ],
        total_impressions_28d: 1901, total_clicks_28d: 0, weighted_position: 9.31,
      },
      expected_upside: { gsc_clicks_28d_delta: 10, note: 'scenario if CTR reaches 2%' },
      impact_score: 60, confidence_score: 70, urgency_score: 40, effort_score: 30, priority_score: 57,
      first_detected_at: '2026-10-20T09:10:47Z', last_detected_at: '2026-11-04T06:30:05Z',
    },
    baseline: {
      frozen_at: '2026-11-04T12:00:00Z',
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
      window: { start: '2026-10-07', end: '2026-11-03' },
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

const which = process.argv[2] ?? 'charizard'
const built = buildClaudePrompt(charizard())
console.log('━━━ v2 PROMPT (' + which + ') ' + built.prompt_version + ' hash=' + built.prompt_hash.slice(0, 12) + ' ━━━\n')
console.log(built.prompt_text)
console.log('\n━━━ END (' + built.prompt_text.length + ' chars) ━━━')
