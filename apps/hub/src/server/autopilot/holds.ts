import 'server-only';

// Holds reader for /admin/content/holds.
//
// A "hold" is either:
//   (a) a scored opportunity (network_content_ideas) that autopilot
//       decided NOT to generate, with hold_reasons set, OR
//   (b) a generated article (network_articles) that failed a QA /
//       budget / adapter gate on the way to publish, with
//       hold_reasons set.
//
// This module reads both tables, normalises them into a single list
// with human-readable reason labels, and sorts newest-first.
//
// No writes here. Admin unholding is a separate action (not in
// checkpoint A).

import type { SupabaseClient } from '@supabase/supabase-js';

export type HoldReasonToken =
  | 'budget_exceeded'
  | 'daily_budget_exceeded'
  | 'monthly_budget_exceeded'
  | 'estimate_exceeds_per_article_cap'
  | 'evidence_insufficient'
  | 'duplicate_topic'
  | 'title_cannibalisation'
  | 'price_claim_failed'
  | 'broken_internal_link'
  | 'image_missing'
  | 'publisher_failed'
  | 'semantic_qa_failed'
  | 'adapter_unavailable'
  | 'autopilot_disabled';

export const HOLD_REASON_LABELS: Record<string, { title: string; detail: string; resolution: string }> = {
  budget_exceeded:                 { title: 'Per-article budget exceeded',       detail: 'The actual AI cost for this article exceeded max_cost_per_article_usd.',          resolution: 'Raise the ceiling, or regenerate with a cheaper model.' },
  daily_budget_exceeded:           { title: 'Daily spend cap reached',           detail: 'daily_article_budget_usd would be exceeded by this reservation.',                resolution: 'Wait for the next 24h cycle or raise the daily cap.' },
  monthly_budget_exceeded:         { title: 'Monthly spend cap reached',         detail: 'monthly_article_budget_usd would be exceeded by this reservation.',              resolution: 'Wait for the next calendar month or raise the monthly cap.' },
  estimate_exceeds_per_article_cap:{ title: 'Projected cost too high',           detail: 'The projected cost of generating this article is above max_cost_per_article_usd.', resolution: 'Trim the evidence pack, switch model, or raise the per-article cap.' },
  evidence_insufficient:           { title: 'Evidence pack insufficient',        detail: 'Deterministic evidence builder could not assemble enough facts to support the article.', resolution: 'Wait for more data (prices, queries, cards) or dismiss the opportunity.' },
  duplicate_topic:                 { title: 'Duplicates existing article',       detail: 'An existing article covers substantially the same topic.',                       resolution: 'Reroute as a refresh of the existing article, or dismiss.' },
  title_cannibalisation:           { title: 'Title would cannibalise existing URL', detail: 'The proposed title/slug overlaps with an existing ranking page on the same site.', resolution: 'Pick a distinct angle or route as refresh.' },
  price_claim_failed:              { title: 'Price claim could not be verified', detail: 'A price or percentage in the draft does not match any evidence-pack entry.',     resolution: 'Regenerate with corrected evidence pack, or dismiss.' },
  broken_internal_link:            { title: 'Internal link does not resolve',    detail: 'One or more internal URLs in the article could not be verified.',                resolution: 'Remove the offending link or correct the URL and republish.' },
  image_missing:                   { title: 'Required image missing',            detail: 'The article template requires a featured image but none was available.',         resolution: 'Attach an eligible image or publish without one if template permits.' },
  publisher_failed:                { title: 'Publisher adapter failed',          detail: 'The target site adapter returned an error on publish.',                           resolution: 'Inspect adapter logs; article remains in approved state for retry.' },
  semantic_qa_failed:              { title: 'Semantic QA flagged issues',        detail: 'The optional semantic-QA pass flagged unsupported or incoherent content.',         resolution: 'Regenerate or dismiss based on QA findings.' },
  adapter_unavailable:             { title: 'Site adapter not auto-publish safe', detail: 'This site is not yet configured for autopilot publishing.',                      resolution: 'Finish adapter work for this site or publish manually.' },
  autopilot_disabled:              { title: 'Autopilot disabled',                detail: 'Global autopilot or per-site enable flag is off at run time.',                    resolution: 'Flip the switch at /admin/content/autopilot when ready.' },
};

export interface HoldRow {
  kind: 'opportunity' | 'article';
  id: string;
  site_slug: string | null;
  site_name: string | null;
  topic: string;
  content_type: string | null;
  decision: string | null;
  score: number | null;
  budget_cents_estimate: number | null;
  budget_cents_actual: number | null;
  hold_reasons: string[];
  held_at: string | null;
  resolution_hint: string;
}

export interface HoldSummary {
  total: number;
  by_reason: Record<string, number>;
  by_site: Record<string, number>;
}

interface IdeaRow {
  id: string;
  site_id: string | null;
  working_title: string;
  content_type: string;
  decision: string | null;
  score: number | null;
  budget_cents_estimate: number | null;
  hold_reasons: string[] | null;
  autopilot_state: string | null;
  scored_at: string | null;
  updated_at: string;
  network_sites: { slug: string; name: string } | null;
}
interface ArticleRow {
  id: string;
  site_id: string;
  title: string;
  content_type: string;
  hold_reasons: string[] | null;
  budget_cents_actual: number | null;
  updated_at: string;
  status: string;
  network_sites: { slug: string; name: string } | null;
}

export async function listHolds(sb: SupabaseClient, limit = 50): Promise<{ rows: HoldRow[]; summary: HoldSummary }> {
  // Opportunity holds — ideas with hold_reasons set.
  const { data: ideaData } = await sb
    .from('network_content_ideas')
    .select('id, site_id, working_title, content_type, decision, score, budget_cents_estimate, hold_reasons, autopilot_state, scored_at, updated_at, network_sites(slug, name)')
    .not('hold_reasons', 'eq', '{}')
    .order('updated_at', { ascending: false })
    .limit(limit);
  const ideas = ((ideaData ?? []) as unknown) as IdeaRow[];

  const { data: articleData } = await sb
    .from('network_articles')
    .select('id, site_id, title, content_type, hold_reasons, budget_cents_actual, updated_at, status, network_sites(slug, name)')
    .not('hold_reasons', 'eq', '{}')
    .order('updated_at', { ascending: false })
    .limit(limit);
  const articles = ((articleData ?? []) as unknown) as ArticleRow[];

  const rows: HoldRow[] = [];
  for (const i of ideas) {
    const reasons = (i.hold_reasons ?? []).filter(Boolean);
    rows.push({
      kind: 'opportunity',
      id: i.id,
      site_slug: i.network_sites?.slug ?? null,
      site_name: i.network_sites?.name ?? null,
      topic: i.working_title,
      content_type: i.content_type,
      decision: i.decision,
      score: i.score,
      budget_cents_estimate: i.budget_cents_estimate,
      budget_cents_actual: null,
      hold_reasons: reasons,
      held_at: i.updated_at,
      resolution_hint: humanResolution(reasons),
    });
  }
  for (const a of articles) {
    const reasons = (a.hold_reasons ?? []).filter(Boolean);
    rows.push({
      kind: 'article',
      id: a.id,
      site_slug: a.network_sites?.slug ?? null,
      site_name: a.network_sites?.name ?? null,
      topic: a.title,
      content_type: a.content_type,
      decision: null,
      score: null,
      budget_cents_estimate: null,
      budget_cents_actual: a.budget_cents_actual,
      hold_reasons: reasons,
      held_at: a.updated_at,
      resolution_hint: humanResolution(reasons),
    });
  }
  rows.sort((a, b) => (b.held_at ?? '').localeCompare(a.held_at ?? ''));

  const by_reason: Record<string, number> = {};
  const by_site: Record<string, number> = {};
  for (const r of rows) {
    for (const reason of r.hold_reasons) {
      by_reason[reason] = (by_reason[reason] ?? 0) + 1;
    }
    const siteKey = r.site_slug ?? '(network)';
    by_site[siteKey] = (by_site[siteKey] ?? 0) + 1;
  }

  return {
    rows: rows.slice(0, limit),
    summary: { total: rows.length, by_reason, by_site },
  };
}

export function humanResolution(reasons: string[]): string {
  if (reasons.length === 0) return 'No action required.';
  // Use the first reason's resolution hint; fall back to a generic.
  const first = reasons[0];
  const entry = first ? HOLD_REASON_LABELS[first] : undefined;
  return entry?.resolution ?? 'Review the hold reasons and resolve manually.';
}
