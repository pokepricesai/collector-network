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
//     snapshot by >= 25 points.
//
//   SNOOZED STILL SNOOZED:
//     Row remains hidden. last_detected_at + scores still refresh
//     on upsert so when the snooze expires the operator sees current
//     evidence.
//
// Phase 1.1 — the engine now:
//
//   • Expects each rule to return RuleRunResult (outputs +
//     diagnostics) rather than a bare array.
//   • Persists a durable record of EVERY run in network_job_runs
//     (job_name='intelligence.refresh') with the full per-rule
//     diagnostics in `metadata`, so operators can retroactively
//     answer "why did rule X emit zero items?".

import type { SupabaseClient } from '@supabase/supabase-js';
import { INTELLIGENCE_RULES } from './rules';
import { computePriority } from './scoring';
import type {
  EngineRunResult, IntelligenceCategory, RuleContext, RuleRunResult, RuleOutcomeStatus,
  RuleScopeDiagnostic, SiteSlug, ScoredItem,
} from './types';

const REOPEN_PRIORITY_DELTA = 25;
const JOB_NAME = 'intelligence.refresh';

interface ExistingRow {
  id: string;
  source_key: string;
  status: 'open' | 'task_created' | 'snoozed' | 'resolved' | 'dismissed';
  priority_score: number;
  dismissed_priority: number | null;
  resolved_reason: string | null;
  task_id: string | null;
}

function aggregateStatus(diags: RuleScopeDiagnostic[]): RuleOutcomeStatus {
  if (diags.length === 0) return 'no_data';
  if (diags.some((d) => d.status === 'error')) return 'error';
  if (diags.some((d) => d.status === 'signals_found')) return 'signals_found';
  if (diags.every((d) => d.status === 'skipped')) return 'skipped';
  if (diags.some((d) => d.status === 'no_signal')) return 'no_signal';
  return 'no_data';
}

export async function runIntelligenceEngine(sb: SupabaseClient): Promise<EngineRunResult> {
  const startedAt = Date.now();
  const runAt     = new Date(startedAt).toISOString();

  // Resolve site list once. network_sites uses `status` not
  // `is_active`; filter on status='active'.
  const { data: siteRows, error: siteErr } = await sb
    .from('network_sites')
    .select('id, slug, name')
    .eq('status', 'active');
  if (siteErr) throw new Error(`[intelligence/engine] fetch sites: ${siteErr.message}`);
  const sites = ((siteRows ?? []) as Array<{ id: string; slug: SiteSlug; name: string }>);
  const siteBySlug: RuleContext['siteBySlug'] = {
    pokemon: undefined, mtg: undefined, ygo: undefined, onepiece: undefined, lorcana: undefined,
  };
  for (const s of sites) siteBySlug[s.slug] = s;

  const ctx: RuleContext = { sb, runAt, sites, siteBySlug };

  const perRule: EngineRunResult['per_rule'] = [];
  const allOutputs: Array<RuleRunResult['outputs'][number]> = [];
  const categoriesScanned = new Set<IntelligenceCategory>();
  let rowsExaminedTotal = 0;
  let rowsSkippedInvalidTotal = 0;
  for (const rule of INTELLIGENCE_RULES) {
    try {
      const result = await rule.run(ctx);
      const emitted = result.outputs.length;
      const status  = aggregateStatus(result.diagnostics);
      perRule.push({
        rule_id: rule.id,
        aggregated_status: status,
        emitted,
        diagnostics: result.diagnostics,
        failed: false,
      });
      for (const d of result.diagnostics) {
        if (typeof d.rows_examined === 'number') rowsExaminedTotal += d.rows_examined;
        if (typeof d.rows_skipped_invalid === 'number') rowsSkippedInvalidTotal += d.rows_skipped_invalid;
      }
      allOutputs.push(...result.outputs);
      for (const c of rule.categoriesScanned) categoriesScanned.add(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      perRule.push({
        rule_id: rule.id,
        aggregated_status: 'error',
        emitted: 0,
        diagnostics: [{ scope: 'network', status: 'error', items_emitted: 0, error: msg }],
        failed: true,
        error: msg,
      });
    }
  }

  // Score + sort for deterministic order (cosmetic; the UI re-sorts
  // from the DB anyway).
  const scored: ScoredItem[] = allOutputs.map((r) => ({
    ...r,
    priority: computePriority({ impact: r.impact, confidence: r.confidence, urgency: r.urgency, effort: r.effort }),
  }));

  // Load current state of EVERY source_key the engine is about to
  // write.
  const sourceKeys = Array.from(new Set(scored.map((s) => s.source_key)));
  const existingBySourceKey = new Map<string, ExistingRow>();
  if (sourceKeys.length > 0) {
    const { data } = await sb
      .from('network_intelligence_items')
      .select('id, source_key, status, priority_score, dismissed_priority, resolved_reason, task_id')
      .in('source_key', sourceKeys);
    for (const r of ((data ?? []) as ExistingRow[])) existingBySourceKey.set(r.source_key, r);
  }

  let items_upserted = 0;
  let items_inserted = 0;
  let items_updated  = 0;
  let items_reopened = 0;
  for (const s of scored) {
    const existing = existingBySourceKey.get(s.source_key);
    // Resolved-for-invalid-source-data reopens unconditionally when
    // the rule's gates now pass. That resolution reason specifically
    // means "data was malformed, keep the audit trail, let it come
    // back if it ever qualifies." The dismissed-row delta logic
    // does NOT apply here — the operator never dismissed this one.
    if (existing && existing.status === 'resolved' && existing.resolved_reason === 'invalid_source_data') {
      await sb.from('network_intelligence_items').update({
        status: 'open',
        resolved_at: null,
        resolved_reason: null,
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
      items_updated  += 1;
      continue;
    }
    if (existing && existing.status === 'dismissed') {
      const prevPriority = existing.dismissed_priority ?? existing.priority_score;
      if (s.priority < prevPriority + REOPEN_PRIORITY_DELTA) continue;
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
      items_updated  += 1;
      continue;
    }

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
      console.error('[intelligence/engine] upsert failed:', s.source_key, error.message);
      continue;
    }
    items_upserted += 1;
    if (existing) items_updated += 1;
    else items_inserted += 1;
  }

  // Stale resolution.
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

  // Snooze expiry.
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

  const finishedAt = new Date();
  const result: EngineRunResult = {
    run_id: '',
    started_at: runAt,
    finished_at: finishedAt.toISOString(),
    duration_ms: Date.now() - startedAt,
    rules_registered: INTELLIGENCE_RULES.length,
    rules_executed: perRule.filter((r) => !r.failed).length,
    rules_failed: perRule.filter((r) => r.failed).length,
    items_upserted,
    items_inserted,
    items_updated,
    items_resolved_auto,
    items_reopened,
    rows_examined_total: rowsExaminedTotal,
    rows_skipped_invalid_total: rowsSkippedInvalidTotal,
    per_rule: perRule,
  };

  // Persist the completion record. network_job_status enum only
  // carries success/warning/failed (no 'running'), so we insert
  // once at the end rather than updating a pre-run row. Crash
  // records are available in Vercel logs.
  const anyFailed = result.rules_failed > 0;
  const finalStatus = anyFailed ? 'warning' : 'success';
  const { data: inserted, error: insErr } = await sb.from('network_job_runs').insert({
    job_name: JOB_NAME,
    job_type: 'engine',
    site_id: null,
    status: finalStatus,
    started_at: runAt,
    finished_at: result.finished_at,
    rows_examined: rowsExaminedTotal,
    rows_inserted: items_inserted,
    rows_updated: items_updated,
    rows_rejected: rowsSkippedInvalidTotal,
    error_summary: anyFailed
      ? perRule.filter((r) => r.failed).map((r) => `${r.rule_id}: ${r.error ?? ''}`).join(' | ').slice(0, 500)
      : null,
    metadata: {
      phase: '1.1',
      duration_ms: result.duration_ms,
      rules_registered: result.rules_registered,
      rules_executed: result.rules_executed,
      rules_failed: result.rules_failed,
      items_upserted,
      items_inserted,
      items_updated,
      items_resolved_auto,
      items_reopened,
      rows_examined_total: rowsExaminedTotal,
      rows_skipped_invalid_total: rowsSkippedInvalidTotal,
      per_rule: perRule,
    },
  }).select('id').single();
  if (insErr) {
    console.error('[intelligence/engine] job_runs insert failed:', insErr.message);
  } else if (inserted) {
    result.run_id = (inserted as { id: string }).id;
  }

  return result;
}
