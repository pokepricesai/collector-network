import 'server-only';

// Newsletter composer. Draft-only. No autosend in Phase 4.
//
// Pulls from the already-approved content sources (published
// articles, daily brief, top price movers) and composes a draft
// newsletter with sections stored in network_newsletter_sections.
// Each section carries a source_kind + source_ref so an editor can
// trace every claim back to its origin.
//
// The output is NOT sent — Luke reviews it in /admin/newsletter.
// Delivery is deferred until a chosen send_target (resend / SES /
// PokePrices studio relay) is configured.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMarketMovers } from '../pokeprices/pricing';

export interface ComposedNewsletter {
  newsletterId: string;
  sectionCount: number;
}

export async function composeWeeklyNewsletter(
  sb: SupabaseClient,
  adminId: string | null,
): Promise<ComposedNewsletter> {
  const now = new Date();
  const for_date = now.toISOString().slice(0, 10);
  const label = `Collector Network weekly — ${for_date}`;

  // Create newsletter row (draft).
  const { data: nlIns, error: nlErr } = await sb.from('network_newsletters').insert({
    title: label,
    subject_line: `This week on the Collector Network — ${for_date}`,
    preheader: 'Market movers, new editorial, and what we\'ve been working on.',
    for_date,
    status: 'draft',
    send_target: 'manual_relay',
    created_by: adminId,
  }).select('id').single();
  if (nlErr) throw new Error(`[newsletter] insert: ${nlErr.message}`);
  const newsletterId = (nlIns as { id: string }).id;

  const sections: Array<{ heading: string; body: string; source_kind: string; source_ref: string | null; evidence: Record<string, unknown> }> = [];

  // Section 1 — recently published articles.
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const { data: articles } = await sb.from('network_articles')
    .select('id, title, summary, publication_url, published_at, content_type, network_sites(slug, name)')
    .eq('status', 'published').gte('published_at', sevenDaysAgo)
    .order('published_at', { ascending: false }).limit(10);
  if ((articles ?? []).length > 0) {
    const lines = ((articles ?? []) as unknown as Array<{ id: string; title: string; summary: string | null; publication_url: string | null; content_type: string; network_sites: { slug: string; name: string } }>).map((a) => {
      const url = a.publication_url ?? '#';
      return `- **[${a.title}](${url})** — ${a.network_sites.name} · ${a.content_type.replace(/_/g, ' ')}${a.summary ? `\n  ${a.summary.slice(0, 220)}` : ''}`;
    });
    sections.push({
      heading: 'New editorial this week',
      body: lines.join('\n\n'),
      source_kind: 'article',
      source_ref: null,
      evidence: { article_count: lines.length },
    });
  }

  // Section 2 — PokePrices market movers (30d).
  try {
    const raw = await getMarketMovers(sb, { grade: 'raw', windowDays: 30, topN: 3 });
    const psa10 = await getMarketMovers(sb, { grade: 'psa10', windowDays: 30, topN: 3 });
    const lines: string[] = [];
    if (raw.risers.length > 0 || raw.fallers.length > 0) {
      lines.push('**Raw (ungraded)**');
      for (const m of raw.risers) lines.push(`- ⬆ ${m.cardName} (${m.setName}) · $${m.startPriceUsd.toFixed(2)} → $${m.endPriceUsd.toFixed(2)} (+${m.pctChange.toFixed(1)}%)`);
      for (const m of raw.fallers) lines.push(`- ⬇ ${m.cardName} (${m.setName}) · $${m.startPriceUsd.toFixed(2)} → $${m.endPriceUsd.toFixed(2)} (${m.pctChange.toFixed(1)}%)`);
    }
    if (psa10.risers.length > 0 || psa10.fallers.length > 0) {
      lines.push('\n**PSA 10**');
      for (const m of psa10.risers) lines.push(`- ⬆ ${m.cardName} (${m.setName}) · $${m.startPriceUsd.toFixed(2)} → $${m.endPriceUsd.toFixed(2)} (+${m.pctChange.toFixed(1)}%)`);
      for (const m of psa10.fallers) lines.push(`- ⬇ ${m.cardName} (${m.setName}) · $${m.startPriceUsd.toFixed(2)} → $${m.endPriceUsd.toFixed(2)} (${m.pctChange.toFixed(1)}%)`);
    }
    if (lines.length > 0) {
      sections.push({
        heading: 'PokePrices — biggest 30-day movers',
        body: lines.join('\n'),
        source_kind: 'mover',
        source_ref: null,
        evidence: { source: 'PokePrices card_trends', window_days: 30 },
      });
    }
  } catch (err) {
    console.error('[newsletter] mover enrichment failed:', (err as Error).message);
  }

  // Section 3 — daily brief notable changes.
  const { data: briefRow } = await sb.from('network_daily_briefs')
    .select('for_date, payload').order('for_date', { ascending: false }).limit(1).maybeSingle();
  const brief = (briefRow as { for_date: string; payload: { notable?: Array<{ title: string; description: string; severity: string; kind: string }>; metrics?: { yesterday?: Record<string, number> } } } | null)?.payload;
  if (brief?.notable && brief.notable.length > 0) {
    const notable = brief.notable.filter((n) => ['critical', 'high'].includes(n.severity)).slice(0, 5);
    if (notable.length > 0) {
      const lines = notable.map((n) => `- **${n.title}** — ${n.description}`);
      sections.push({
        heading: 'Across the network',
        body: lines.join('\n\n'),
        source_kind: 'brief',
        source_ref: null,
        evidence: { brief_date: (briefRow as { for_date: string } | null)?.for_date, item_count: lines.length },
      });
    }
  }

  // Insert sections.
  if (sections.length > 0) {
    const rows = sections.map((s, i) => ({
      newsletter_id: newsletterId, position: i + 1,
      heading: s.heading, body_markdown: s.body,
      source_kind: s.source_kind, source_ref: s.source_ref,
      evidence: s.evidence,
    }));
    const { error } = await sb.from('network_newsletter_sections').insert(rows);
    if (error) throw new Error(`[newsletter] insert sections: ${error.message}`);
  }

  await sb.rpc('network_log_audit', {
    p_action: 'newsletter.composed',
    p_entity_type: 'network_newsletter', p_entity_id: newsletterId,
    p_site_id: null, p_old_value: null,
    p_new_value: { section_count: sections.length, for_date } as unknown as Record<string, unknown>,
    p_actor_type: 'human', p_source: 'manual',
    p_metadata: {} as unknown as Record<string, unknown>,
  });

  return { newsletterId, sectionCount: sections.length };
}
