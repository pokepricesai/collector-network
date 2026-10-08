import 'server-only';

// Read-side queries for the Intelligence Inbox UI. All reads go
// through here so the page component stays declarative.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntelligenceCategory, IntelligenceStatus, IntelligenceTone, SiteSlug } from './types';

export interface IntelligenceRowRead {
  id: string;
  site_id: string | null;
  category: IntelligenceCategory;
  type: string;
  tone: IntelligenceTone;
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
    by_tone: Record<string, number>;
    by_status: Record<string, number>;
    critical: number;
    high: number;
    opportunities: number;
    risks: number;
    tasks_created: number;
  };
}

export async function listIntelligenceInbox(
  sb: SupabaseClient,
  filters: IntelligenceInboxFilters = {},
): Promise<IntelligenceInboxResult> {
  const statuses = filters.statuses ?? ['open', 'task_created'];
  let q = sb.from('network_intelligence_items')
    .select('id, site_id, category, type, tone, title, summary, recommended_action, evidence, expected_upside, source_type, source_id, source_key, impact_score, confidence_score, urgency_score, effort_score, priority_score, status, task_id, first_detected_at, last_detected_at, snoozed_until, resolved_at, dismissed_at, metadata, network_sites(slug, name)')
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
  if (error) throw new Error(`[intelligence/queries] list: ${error.message}`);
  const rows = ((data ?? []) as unknown) as IntelligenceRowRead[];

  const summary = {
    total: rows.length,
    by_category: {} as Record<string, number>,
    by_tone: {} as Record<string, number>,
    by_status: {} as Record<string, number>,
    critical: 0,
    high: 0,
    opportunities: 0,
    risks: 0,
    tasks_created: 0,
  };
  for (const r of rows) {
    summary.by_category[r.category] = (summary.by_category[r.category] ?? 0) + 1;
    summary.by_tone[r.tone] = (summary.by_tone[r.tone] ?? 0) + 1;
    summary.by_status[r.status] = (summary.by_status[r.status] ?? 0) + 1;
    if (r.priority_score >= 85) summary.critical += 1;
    else if (r.priority_score >= 70) summary.high += 1;
    if (r.tone === 'opportunity' || r.tone === 'positive') summary.opportunities += 1;
    if (r.tone === 'risk' || r.tone === 'warning') summary.risks += 1;
    if (r.status === 'task_created' && r.task_id) summary.tasks_created += 1;
  }
  return { rows, summary };
}
