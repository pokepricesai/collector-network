import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

// Pipeline model: 10 active stages (we hide 'nurture' and 'archived'
// from the board but keep them in sidebar counts).
export const PIPELINE_STAGES = [
  'prospect', 'researching', 'ready_to_contact', 'contacted', 'replied',
  'meeting', 'proposal', 'negotiating', 'won', 'lost',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Standard forecasting probability per stage. Used for weighted ACV.
// These are a reasonable B2B defaults; operator can override via feature
// flag/env later if needed.
export const STAGE_PROBABILITY: Record<string, number> = {
  prospect: 0.05,
  researching: 0.10,
  ready_to_contact: 0.15,
  contacted: 0.25,
  replied: 0.35,
  meeting: 0.50,
  proposal: 0.65,
  negotiating: 0.80,
  won: 1.00,
  lost: 0,
  nurture: 0,
  archived: 0,
};

export interface PipelineRow {
  id: string;
  slug: string;
  display_name: string;
  vendor_category: string | null;
  status: string;
  fit_score: number | null;
  estimated_size: string | null;
  priority: number;
  website: string | null;
  recommended_price_minor: number | null;
  recommended_currency: string | null;
  next_action: string | null;
  next_action_due: string | null;
  last_contact_at: string | null;
  first_wave: boolean;
  tags: string[];
}

export async function listPipelineRows(
  sb: SupabaseClient,
  filters?: { ownerId?: string; category?: string; tcg?: string; priority?: number },
): Promise<PipelineRow[]> {
  let q = sb.from('network_partners')
    .select('id, slug, display_name, vendor_category, status, fit_score, estimated_size, priority, website, recommended_price_minor, recommended_currency, next_action, next_action_due, last_contact_at, first_wave, tags, relevant_tcgs, owner_user_id')
    .not('vendor_category', 'is', null)
    .in('status', [...PIPELINE_STAGES, 'nurture', 'archived']);
  if (filters?.ownerId) q = q.eq('owner_user_id', filters.ownerId);
  if (filters?.category) q = q.eq('vendor_category', filters.category);
  if (filters?.tcg) q = q.contains('relevant_tcgs', [filters.tcg]);
  if (filters?.priority != null) q = q.eq('priority', filters.priority);
  const { data, error } = await q.order('priority', { ascending: true }).order('fit_score', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`[pipeline] list: ${error.message}`);
  return (data ?? []) as unknown as PipelineRow[];
}

export interface StageSummary {
  stage: PipelineStage | 'nurture' | 'archived';
  count: number;
  monthly_minor: number;
  acv_minor: number;
  weighted_acv_minor: number;
}

export function summarise(rows: PipelineRow[]): StageSummary[] {
  const map = new Map<string, StageSummary>();
  for (const r of rows) {
    const stage = r.status as StageSummary['stage'];
    const monthly = r.recommended_price_minor ?? 0;
    const acv = monthly * 12;
    const weight = STAGE_PROBABILITY[stage] ?? 0;
    const entry = map.get(stage) ?? { stage, count: 0, monthly_minor: 0, acv_minor: 0, weighted_acv_minor: 0 };
    entry.count += 1;
    entry.monthly_minor += monthly;
    entry.acv_minor += acv;
    entry.weighted_acv_minor += Math.round(acv * weight);
    map.set(stage, entry);
  }
  return Array.from(map.values());
}

export interface MorningBuckets {
  overdue: PipelineRow[];
  dueToday: PipelineRow[];
  dueThisWeek: PipelineRow[];
  waveAwaitingSend: PipelineRow[];
  recentInbound: Array<{ partner_id: string; display_name: string; summary: string; occurred_at: string }>;
}

export async function buildMorningBuckets(sb: SupabaseClient): Promise<MorningBuckets> {
  const rows = await listPipelineRows(sb);
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);

  const overdue = rows.filter((r) => r.next_action_due && r.next_action_due < today && !['won','lost','archived','nurture'].includes(r.status));
  const dueToday = rows.filter((r) => r.next_action_due === today && !['won','lost','archived','nurture'].includes(r.status));
  const dueThisWeek = rows.filter((r) => r.next_action_due && r.next_action_due > today && r.next_action_due <= in7 && !['won','lost','archived','nurture'].includes(r.status));

  // Wave prospects with a CN-06C draft but no email_sent interaction yet.
  const waveIds = rows.filter((r) => r.first_wave).map((r) => r.id);
  let waveAwaiting: PipelineRow[] = [];
  if (waveIds.length > 0) {
    const [{ data: drafts }, { data: sends }] = await Promise.all([
      sb.from('network_partner_interactions').select('partner_id').in('partner_id', waveIds).ilike('summary', '[DRAFT CN-06C wave-1]%'),
      sb.from('network_partner_interactions').select('partner_id').in('partner_id', waveIds).eq('kind', 'email_sent'),
    ]);
    const hasDraft = new Set((drafts ?? []).map((d) => d.partner_id));
    const hasSent = new Set((sends ?? []).map((d) => d.partner_id));
    waveAwaiting = rows.filter((r) => r.first_wave && hasDraft.has(r.id) && !hasSent.has(r.id));
  }

  // Last 7 days of inbound interactions.
  const since = new Date(Date.now() - 86400000 * 7).toISOString();
  const { data: inboundRaw } = await sb.from('network_partner_interactions')
    .select('partner_id, summary, occurred_at')
    .eq('direction', 'inbound')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(20);
  const partnerMap = new Map(rows.map((r) => [r.id, r.display_name]));
  const recentInbound = (inboundRaw ?? [])
    .filter((r) => partnerMap.has(r.partner_id))
    .map((r) => ({
      partner_id: r.partner_id,
      display_name: partnerMap.get(r.partner_id) ?? '(unknown)',
      summary: r.summary,
      occurred_at: r.occurred_at,
    }));

  return { overdue, dueToday, dueThisWeek, waveAwaitingSend: waveAwaiting, recentInbound };
}
