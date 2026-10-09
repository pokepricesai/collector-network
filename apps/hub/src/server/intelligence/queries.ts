import 'server-only';

// Read-side queries for the Intelligence Inbox UI. All reads go
// through here so the page component stays declarative.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntelligenceCategory, IntelligenceStatus, IntelligenceSignalKind, SiteSlug } from './types';

export interface IntelligenceRowRead {
  id: string;
  site_id: string | null;
  category: IntelligenceCategory;
  type: string;
  signal_kind: IntelligenceSignalKind;
  title: string;
  summary: string;
  recommended_action: string;
  evidence: Record<string, unknown>;
  expected_upside: Record<string, unknown> | null;
  source_type: string;
  source_id: string | null;
  source_key: string;
  impact_score: number;
  confidence_score: number;
  urgency_score: number;
  effort_score: number;
  priority_score: number;
  status: IntelligenceStatus;
  task_id: string | null;
  first_detected_at: string;
  last_detected_at: string;
  snoozed_until: string | null;
  resolved_at: string | null;
  dismissed_at: string | null;
  metadata: Record<string, unknown>;
  // Join
  network_sites: { slug: SiteSlug; name: string } | null;
}

export interface IntelligenceInboxFilters {
  site_slug?: SiteSlug | null;         // null = network-wide only; undefined = all
  category?: IntelligenceCategory | null;
  statuses?: IntelligenceStatus[];
  limit?: number;
}

export interface IntelligenceInboxResult {
  rows: IntelligenceRowRead[];
  summary: {
    total: number;
    by_category: Record<string, number>;
    by_signal_kind: Record<string, number>;
    by_status: Record<string, number>;
    critical: number;
    high: number;
    opportunities: number;
    risks: number;
    tasks_created: number;
  };
  // Populated when the query failed (transient / schema cache / RLS
  // misconfiguration). The page surfaces it instead of crashing out
  // the whole admin shell. Null = query succeeded.
  error: string | null;
}

export async function listIntelligenceInbox(
  sb: SupabaseClient,
  filters: IntelligenceInboxFilters = {},
): Promise<IntelligenceInboxResult> {
  const statuses = filters.statuses ?? ['open', 'task_created'];
  let q = sb.from('network_intelligence_items')
    .select('id, site_id, category, type, signal_kind, title, summary, recommended_action, evidence, expected_upside, source_type, source_id, source_key, impact_score, confidence_score, urgency_score, effort_score, priority_score, status, task_id, first_detected_at, last_detected_at, snoozed_until, resolved_at, dismissed_at, metadata, network_sites(slug, name)')
    .in('status', statuses)
    .order('priority_score', { ascending: false })
    .order('last_detected_at', { ascending: false })
    .limit(filters.limit ?? 200);

  // Category filter.
  if (filters.category) q = q.eq('category', filters.category);

  // Site filter: slug === null means "network-only"; slug === a slug
  // means that site's rows only; undefined means no filter.
  if (filters.site_slug === null) {
    q = q.is('site_id', null);
  } else if (filters.site_slug) {
    const { data: site } = await sb.from('network_sites').select('id').eq('slug', filters.site_slug).maybeSingle();
    if (site) q = q.eq('site_id', (site as { id: string }).id);
  }

  const { data, error } = await q;
  // Transient failures (PostgREST schema cache stale after a rename,
  // RLS misconfiguration, DB restart) must not take down the whole
  // admin shell. Return an empty result + a surfaced error string so
  // the page can render the empty state with an inline notice.
  if (error) {
    console.error('[intelligence/queries] list failed:', error.message);
    return {
      rows: [],
      summary: emptySummary(),
      error: error.message,
    };
  }
  const rawRows = ((data ?? []) as unknown) as Array<Partial<IntelligenceRowRead>>;

  // Per-row defensive normalisation. One malformed row (missing
  // required field, invalid enum from an in-flight migration) MUST
  // NOT break the page — skip the row and keep rendering.
  const rows: IntelligenceRowRead[] = [];
  for (const r of rawRows) {
    if (typeof r.id !== 'string' || !r.id) continue;
    if (typeof r.title !== 'string') continue;
    if (typeof r.status !== 'string') continue;
    if (typeof r.signal_kind !== 'string') continue;
    if (typeof r.priority_score !== 'number') continue;
    rows.push({
      id: r.id,
      site_id: r.site_id ?? null,
      category: (r.category ?? 'seo') as IntelligenceCategory,
      type: r.type ?? '',
      signal_kind: r.signal_kind as IntelligenceSignalKind,
      title: r.title,
      summary: r.summary ?? '',
      recommended_action: r.recommended_action ?? '',
      evidence: (r.evidence ?? {}) as Record<string, unknown>,
      expected_upside: (r.expected_upside ?? null) as Record<string, unknown> | null,
      source_type: r.source_type ?? '',
      source_id: r.source_id ?? null,
      source_key: r.source_key ?? '',
      impact_score:     Number(r.impact_score     ?? 0),
      confidence_score: Number(r.confidence_score ?? 0),
      urgency_score:    Number(r.urgency_score    ?? 0),
      effort_score:     Number(r.effort_score     ?? 0),
      priority_score:   Number(r.priority_score),
      status: r.status as IntelligenceStatus,
      task_id: r.task_id ?? null,
      first_detected_at: r.first_detected_at ?? '',
      last_detected_at:  r.last_detected_at ?? '',
      snoozed_until: r.snoozed_until ?? null,
      resolved_at:   r.resolved_at ?? null,
      dismissed_at:  r.dismissed_at ?? null,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      network_sites: r.network_sites ?? null,
    });
  }

  const summary = emptySummary();
  summary.total = rows.length;
  for (const r of rows) {
    summary.by_category[r.category] = (summary.by_category[r.category] ?? 0) + 1;
    summary.by_signal_kind[r.signal_kind] = (summary.by_signal_kind[r.signal_kind] ?? 0) + 1;
    summary.by_status[r.status] = (summary.by_status[r.status] ?? 0) + 1;
    if (r.priority_score >= 85) summary.critical += 1;
    else if (r.priority_score >= 70) summary.high += 1;
    if (r.signal_kind === 'opportunity' || r.signal_kind === 'positive') summary.opportunities += 1;
    if (r.signal_kind === 'risk' || r.signal_kind === 'warning') summary.risks += 1;
    if (r.status === 'task_created' && r.task_id) summary.tasks_created += 1;
  }
  return { rows, summary, error: null };
}

function emptySummary(): IntelligenceInboxResult['summary'] {
  return {
    total: 0,
    by_category: {},
    by_signal_kind: {},
    by_status: {},
    critical: 0,
    high: 0,
    opportunities: 0,
    risks: 0,
    tasks_created: 0,
  };
}
