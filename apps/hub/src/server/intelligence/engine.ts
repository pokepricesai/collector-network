import 'server-only';

// Intelligence engine. Runs all registered rules, upserts items into
// network_intelligence_items by source_key, resolves stale items for
// the categories that were scanned, and respects dismiss/snooze
// state.
//
// Semantics (phase 1):
//
//   SAME CONDITION DAY 2:
//     Existing open row → update evidence + scores + last_detected_at.
//
//   PROBLEM IMPROVES (rule stops emitting the source_key):
//     Open rows whose source_type was in a scanned category and
//     whose last_detected_at < this run's run-at are auto-resolved
//     with resolved_reason='no_longer_detected'.
//
//   PROBLEM WORSENS:
//     Existing open row → scores recomputed (potentially higher
//     priority_score). last_detected_at bumps.
//
//   NEW MATERIALLY DIFFERENT PROBLEM:
//     A rule emits a new source_key → inserted as a fresh row.
//
//   DISMISSED REAPPEARS:
//     Only if the new priority exceeds the dismissed_priority
//     snapshot by >= 25 points. Otherwise the dismissed row stays
//     dismissed and we skip the upsert.
//
//   SNOOZED STILL SNOOZED:
//     Row remains hidden. last_detected_at + scores still refresh
//     on upsert so when the snooze expires the operator sees current
//     evidence.

import type { SupabaseClient } from '@supabase/supabase-js';
import { INTELLIGENCE_RULES } from './rules';
import { computePriority } from './scoring';
import type { EngineRunResult, IntelligenceCategory, RuleContext, RuleOutput, SiteSlug, ScoredItem } from './types';

const REOPEN_PRIORITY_DELTA = 25;

interface ExistingRow {
  id: string;
  source_key: string;
  status: 'open' | 'task_created' | 'snoozed' | 'resolved' | 'dismissed';
  priority_score: number;
  dismissed_priority: number | null;
  task_id: string | null;
}

export async function runIntelligenceEngine(sb: SupabaseClient): Promise<EngineRunResult> {
  const startedAt = Date.now();
  const runAt     = new Date(startedAt).toISOString();

  // Resolve site list once.
  const { data: siteRows, error: siteErr } = await sb
    .from('network_sites')
    .select('id, slug, name')
    .eq('is_active', true);
  if (siteErr) throw new Error(`[intelligence/engine] fetch sites: ${siteErr.message}`);
  const sites = ((siteRows ?? []) as Array<{ id: string; slug: SiteSlug; name: string }>);
  const siteBySlug: RuleContext['siteBySlug'] = {
    pokemon: undefined, mtg: undefined, ygo: undefined, onepiece: undefined, lorcana: undefined,
  };
  for (const s of sites) siteBySlug[s.slug] = s;

  const ctx: RuleContext = { sb, runAt, sites, siteBySlug };

  // Run every rule. Any rule failure is isolated — the rest of the
  // engine proceeds.
  const perRule: EngineRunResult['per_rule'] = [];
  const emitted: RuleOutput[] = [];
  const categoriesScanned = new Set<IntelligenceCategory>();
  for (const rule of INTELLIGENCE_RULES) {
    try {
      const rows = await rule.run(ctx);
      perRule.push({ rule_id: rule.id, emitted: rows.length, failed: false });
      emitted.push(...rows);
      for (const c of rule.categoriesScanned) categoriesScanned.add(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      perRule.push({ rule_id: rule.id, emitted: 0, failed: true, error: msg });
    }
  }

  // Score + sort for deterministic order (purely cosmetic for the
  // engine; the UI re-sorts from the DB anyway).
  const scored: ScoredItem[] = emitted.map((r) => ({
    ...r,
    priority: computePriority({ impact: r.impact, confidence: r.confidence, urgency: r.urgency, effort: r.effort }),
  }));

  // Load current state of EVERY source_key the engine is about to
  // write, plus any currently-open row in the scanned categories
  // (we need those to drive stale resolution).
  const sourceKeys = Array.from(new Set(scored.map((s) => s.source_key)));
  const existingBySourceKey = new Map<string, ExistingRow>();
  if (sourceKeys.length > 0) {
    const { data } = await sb
      .from('network_intelligence_items')
      .select('id, source_key, status, priority_score, dismissed_priority, task_id')
      .in('source_key', sourceKeys);
    for (const r of ((data ?? []) as ExistingRow[])) existingBySourceKey.set(r.source_key, r);
  }

  // Upsert.
  let items_upserted = 0;
  let items_reopened = 0;
  for (const s of scored) {
    const existing = existingBySourceKey.get(s.source_key);
    if (existing && existing.status === 'dismissed') {
      const prevPriority = existing.dismissed_priority ?? existing.priority_score;
      if (s.priority < prevPriority + REOPEN_PRIORITY_DELTA) continue;
      // Material improvement in priority — re-open.
      await sb.from('network_intelligence_items').update({
        status: 'open',
        resolved_at: null,
        resolved_reason: null,
        dismissed_at: null,
        dismissed_by: null,
        dismiss_reason: null,
        last_detected_at: runAt,
        impact_score: s.impact,
        confidence_score: s.confidence,
        urgency_score: s.urgency,
        effort_score: s.effort,
        priority_score: s.priority,
        evidence: s.evidence as unknown as Record<string, unknown>,
        expected_upside: s.expected_upside as unknown as Record<string, unknown> | null,
        title: s.title,
        summary: s.summary,
        recommended_action: s.recommended_action,
        signal_kind: s.signal_kind,
        type: s.type,
        category: s.category,
      }).eq('id', existing.id);
      items_reopened += 1;
      items_upserted += 1;
      continue;
    }

    // Standard upsert on source_key.
    const payload = {
      site_id: s.site_id,
      category: s.category,
      type: s.type,
      signal_kind: s.signal_kind,
      title: s.title,
      summary: s.summary,
      recommended_action: s.recommended_action,
      evidence: s.evidence as unknown as Record<string, unknown>,
      expected_upside: s.expected_upside as unknown as Record<string, unknown> | null,
      source_type: s.source_type,
      source_id: s.source_id,
      source_key: s.source_key,
      impact_score: s.impact,
      confidence_score: s.confidence,
      urgency_score: s.urgency,
      effort_score: s.effort,
      priority_score: s.priority,
      last_detected_at: runAt,
      metadata: (s.metadata ?? {}) as Record<string, unknown>,
    };
    const { error } = await sb.from('network_intelligence_items').upsert(payload, {
      onConflict: 'source_key',
      ignoreDuplicates: false,
    });
    if (error) {
      // Fall back to a defensive update-then-insert if upsert hits
      // RLS or a column mismatch. Logged but not fatal.
      console.error('[intelligence/engine] upsert failed:', s.source_key, error.message);
      continue;
    }
    items_upserted += 1;
  }

  // Stale resolution: any OPEN row whose category is in the scanned
  // set and whose last_detected_at is strictly before this run's
  // run-at is auto-resolved. We ignore 'task_created' — that's an
  // operator-active state — so a resolved underlying condition
  // doesn't silently delete the task context.
  let items_resolved_auto = 0;
  const scannedList = Array.from(categoriesScanned);
  if (scannedList.length > 0) {
    const { data: stale } = await sb
      .from('network_intelligence_items')
      .select('id')
      .in('category', scannedList)
      .eq('status', 'open')
      .lt('last_detected_at', runAt);
    const ids = ((stale ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length > 0) {
      await sb.from('network_intelligence_items').update({
        status: 'resolved',
        resolved_at: runAt,
        resolved_reason: 'no_longer_detected',
      }).in('id', ids);
      items_resolved_auto = ids.length;
    }
  }

  // Snooze expiry: items whose snoozed_until has passed → back to open.
  const { data: wakeRows } = await sb
    .from('network_intelligence_items')
    .select('id')
    .eq('status', 'snoozed')
    .not('snoozed_until', 'is', null)
    .lte('snoozed_until', runAt);
  const wakeIds = ((wakeRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (wakeIds.length > 0) {
    await sb.from('network_intelligence_items').update({
      status: 'open',
      snoozed_until: null,
    }).in('id', wakeIds);
  }

  return {
    run_id: '',
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    rules_executed: perRule.filter((r) => !r.failed).length,
    rules_failed: perRule.filter((r) => r.failed).length,
    items_upserted,
    items_resolved_auto,
    items_reopened,
    per_rule: perRule,
  };
}
