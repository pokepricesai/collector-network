import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// CN-05 OS Phase A.2 — Claude Code writing-brief builder.
//
// Pure, deterministic prompt that gives Claude Code everything it
// needs to write an article offline. Zero AI API calls — the $1/7d
// article-AI budget is reserved for the system's own AI drafts and
// must not be consumed by this path.
//
// The brief includes:
//   * Site + voice (audience, tone, do-not, canonical rules)
//   * Topic (idea title + content type + summary + notes)
//   * Market / GSC data for the site (top queries, ranking pages)
//   * Deterministic evidence (what the originating rule saw)
//   * Related published articles (so Claude can internally link)
//   * Suggested internal-link targets with reasons
//   * SEO requirements, verification requirements, structured output
//   * Explicit instruction to create a DRAFT only (never publish)
//
// Not stored. Rendered on-demand on the idea detail page. The hash
// is included for operator reference but no audit row is written.

const WRITING_BRIEF_VERSION = 'cn05-writing-brief-v1';

export interface BuiltWritingBrief {
  prompt_text: string;
  prompt_hash: string;
  prompt_version: string;
  generated_at: string;
}

interface IdeaRow {
  id: string;
  site_id: string;
  status: string;
  working_title: string;
  content_type: string;
  primary_query: string | null;
  secondary_queries: string[];
  summary: string | null;
  notes: string | null;
  origin_type: string;
  evidence: Record<string, unknown>;
  network_sites: { slug: string; name: string; domain: string | null };
}

export async function buildWritingBrief(
  sb: SupabaseClient,
  ideaId: string,
): Promise<BuiltWritingBrief | { error: string }> {
  const { data: ideaRow, error: ideaErr } = await sb
    .from('network_content_ideas')
    .select('id, site_id, status, working_title, content_type, primary_query, secondary_queries, summary, notes, origin_type, evidence, network_sites(slug, name, domain)')
    .eq('id', ideaId)
    .maybeSingle();
  if (ideaErr) return { error: `load idea: ${ideaErr.message}` };
  if (!ideaRow) return { error: 'idea not found' };
  const idea = ideaRow as unknown as IdeaRow;
  if (idea.status !== 'approved') {
    return { error: `idea status is ${idea.status}; brief only emitted for approved ideas` };
  }

  // Load voice (optional — some sites still lack a voice profile).
  const { data: voiceRow } = await sb
    .from('network_voice_profiles')
    .select('audience, tone, terminology, content_emphasis, preferred_structure, balance, do_not, naming_rules, canonical_tag')
    .eq('site_id', idea.site_id)
    .maybeSingle();
  const voice = voiceRow as {
    audience: string | null; tone: string | null; terminology: string | null;
    content_emphasis: string | null; preferred_structure: string | null;
    balance: string | null; do_not: string | null;
    naming_rules: string | null; canonical_tag: string | null;
  } | null;

  // GSC context — matches the briefs.ts loader so Claude sees the
  // same demand signal the system would use internally. 28-day window.
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 28);
  const sinceIso = since.toISOString().slice(0, 10);
  const [{ data: queries }, { data: pages }, { data: linkOpps }, { data: existingArticles }] = await Promise.all([
    sb.from('network_gsc_query_daily')
      .select('query, clicks, impressions, position_avg')
      .eq('site_id', idea.site_id).gte('date', sinceIso)
      .order('impressions', { ascending: false }).limit(50),
    sb.from('network_gsc_url_daily')
      .select('page, clicks, impressions')
      .eq('site_id', idea.site_id).gte('date', sinceIso)
      .order('impressions', { ascending: false }).limit(30),
    sb.from('network_internal_link_opportunities')
      .select('target_url, reason, evidence')
      .eq('site_id', idea.site_id).eq('status', 'open').limit(15),
    sb.from('network_articles')
      .select('title, slug, publication_url, summary')
      .eq('site_id', idea.site_id).eq('status', 'published').limit(30),
  ]);

  const qAgg = new Map<string, { impressions: number; clicks: number; posW: number; posD: number }>();
  for (const r of (queries ?? []) as Array<{ query: string; clicks: number; impressions: number; position_avg: number | null }>) {
    const prev = qAgg.get(r.query);
    if (!prev) qAgg.set(r.query, { impressions: r.impressions, clicks: r.clicks, posW: (r.position_avg ?? 0) * r.impressions, posD: r.impressions });
    else { prev.impressions += r.impressions; prev.clicks += r.clicks; prev.posW += (r.position_avg ?? 0) * r.impressions; prev.posD += r.impressions; }
  }
  const relatedQueries = [...qAgg.entries()]
    .map(([q, m]) => ({ query: q, impressions: m.impressions, clicks: m.clicks, position: m.posD > 0 ? Number((m.posW / m.posD).toFixed(1)) : null }))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 15);

  const pAgg = new Map<string, { impressions: number; clicks: number }>();
  for (const r of (pages ?? []) as Array<{ page: string; clicks: number; impressions: number }>) {
    const prev = pAgg.get(r.page);
    if (!prev) pAgg.set(r.page, { impressions: r.impressions, clicks: r.clicks });
    else { prev.impressions += r.impressions; prev.clicks += r.clicks; }
  }
  const rankingPages = [...pAgg.entries()]
    .map(([p, m]) => ({ page: p, impressions: m.impressions, clicks: m.clicks }))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 10);

  const sections: string[] = [];

  // 1. Header
  sections.push(`# CN-05 Writing Brief: ${idea.working_title}`);
  sections.push(`**Idea ID:** \`${idea.id}\``);
  sections.push(`**Site:** ${idea.network_sites.name} (${idea.network_sites.slug})${idea.network_sites.domain ? ` — https://${idea.network_sites.domain}` : ''}`);
  sections.push(`**Content type:** ${idea.content_type.replace(/_/g, ' ')} · **Origin:** ${idea.origin_type}`);

  // 2. Topic
  sections.push('\n## Topic');
  if (idea.primary_query) sections.push(`**Primary query / angle:** \`${idea.primary_query}\``);
  if (idea.secondary_queries && idea.secondary_queries.length > 0) {
    sections.push(`**Secondary queries:** ${idea.secondary_queries.map((q) => '`' + q + '`').join(', ')}`);
  }
  if (idea.summary) sections.push(`\n${idea.summary}`);
  if (idea.notes) sections.push(`\n**Editorial notes:** ${idea.notes}`);

  // 3. Voice
  if (voice) {
    sections.push('\n## Site voice');
    if (voice.audience) sections.push(`**Audience:** ${voice.audience}`);
    if (voice.tone) sections.push(`**Tone:** ${voice.tone}`);
    if (voice.terminology) sections.push(`**Terminology:** ${voice.terminology}`);
    if (voice.content_emphasis) sections.push(`**Content emphasis:** ${voice.content_emphasis}`);
    if (voice.preferred_structure) sections.push(`**Preferred structure:** ${voice.preferred_structure}`);
    if (voice.balance) sections.push(`**Balance:** ${voice.balance}`);
    if (voice.naming_rules) sections.push(`**Naming rules:** ${voice.naming_rules}`);
    if (voice.do_not) sections.push(`\n**Do NOT:** ${voice.do_not}`);
  }

  // 4. Market / GSC data
  sections.push('\n## Market data (GSC, 28-day)');
  if (relatedQueries.length > 0) {
    sections.push('Top related queries by impressions:');
    sections.push('```json');
    sections.push(JSON.stringify(relatedQueries, null, 2));
    sections.push('```');
  } else {
    sections.push('_No GSC query data for this site in the last 28 days._');
  }
  if (rankingPages.length > 0) {
    sections.push('\nTop ranking pages (useful for internal links + angle differentiation):');
    sections.push('```json');
    sections.push(JSON.stringify(rankingPages, null, 2));
    sections.push('```');
  }

  // 5. Evidence (what the originating rule saw)
  sections.push('\n## Deterministic evidence');
  sections.push('```json');
  sections.push(JSON.stringify(idea.evidence ?? {}, null, 2));
  sections.push('```');

  // 6. Internal link targets
  const linkTargets = ((linkOpps ?? []) as Array<{ target_url: string; reason: string; evidence: Record<string, unknown> }>);
  if (linkTargets.length > 0) {
    sections.push('\n## Suggested internal link targets');
    for (const l of linkTargets.slice(0, 10)) {
      sections.push(`- \`${l.target_url}\` — ${l.reason}`);
    }
  }

  // 7. Related published articles
  const articles = ((existingArticles ?? []) as Array<{ title: string; slug: string; publication_url: string | null; summary: string | null }>);
  if (articles.length > 0) {
    sections.push('\n## Related published articles (link to these where relevant)');
    for (const a of articles.slice(0, 15)) {
      sections.push(`- [${a.title}](${a.publication_url ?? '/insights/' + a.slug})${a.summary ? ` — ${a.summary.slice(0, 160)}` : ''}`);
    }
  }

  // 8. SEO requirements
  sections.push('\n## SEO requirements');
  sections.push([
    `- **Working title:** ${idea.working_title} (feel free to improve while keeping intent)`,
    `- **Slug:** URL-safe, ≤120 chars, no stop words at start; keep primary intent in the first 3 tokens`,
    `- **Meta title:** ≤60 chars, lead with the entity, include the primary query token`,
    `- **Meta description:** 140–160 chars, specific and clickable, one benefit + one proof`,
    voice?.canonical_tag ? `- **Canonical rule:** ${voice.canonical_tag}` : '- **Canonical:** self (default)',
    `- **Standfirst (dek):** one sentence framing the article's angle for a scanning reader`,
    `- **Summary:** 1–2 sentences for internal cards and the site index`,
  ].join('\n'));

  // 9. Structure
  sections.push('\n## Structure');
  sections.push([
    '- Open with the reader\'s question or the hook from the GSC query — do not bury the lede.',
    '- 3–6 H2 sections. Each H2 should resolve a sub-question or deliver a concrete answer.',
    '- Use H3s only when an H2 genuinely has multiple parallel points.',
    '- Short paragraphs (≤4 sentences). One idea per paragraph.',
    '- Include a "What to do next" close that links to 1–2 related articles above.',
    '- Images are optional; include alt text if used.',
  ].join('\n'));

  // 10. Verification requirements
  sections.push('\n## Verification requirements');
  sections.push([
    '- Every price, date, population count, deck percentage, or market stat must be sourced.',
    '- Prefer first-party / primary sources: our own `/card/*`, `/set/*`, GSC view, Impact dashboard. Fallbacks: Wizards official, Pokémon official, TCGPlayer, Konami.',
    '- Never cite competitor pricing aggregators as proof.',
    '- If you cannot verify a fact in a reasonable time, OMIT it rather than guessing.',
    '- Carry source citations into the `sources` field of the output JSON.',
  ].join('\n'));

  // 11. Operating constraints
  sections.push('\n## Constraints');
  sections.push([
    '- **Do NOT publish.** Create a DRAFT only — status must remain `draft` or `review`.',
    '- **Do NOT schedule.** Scheduling is a human action after review approves the draft.',
    '- **Do NOT consume the site AI budget.** You are a human-equivalent writer here; the $1/7d article-AI ceiling is reserved for our system\'s AI-draft path and must not be touched by this workflow.',
    '- Protect PokePrices SEO recovery: no public card-page or pricing changes.',
    '- No new paid dependencies.',
  ].join('\n'));

  // 12. Structured output format
  sections.push('\n## Structured output (paste this exact JSON back into the OS)');
  sections.push(
    'When done, return a JSON block that the Hub\'s paste-draft importer can consume. Prose context before/after the JSON is fine.',
  );
  sections.push('```json');
  sections.push(JSON.stringify({
    idea_id: idea.id,
    title: '<final H1 title, ≤120 chars>',
    slug: '<url-safe slug, ≤120 chars>',
    meta_title: '<SEO title, ≤60 chars>',
    meta_description: '<SEO description, 140–160 chars>',
    standfirst: '<one-sentence dek>',
    summary: '<1–2 sentence card summary>',
    body_markdown: '<the full article body in Markdown — H2/H3 headings, paragraphs, lists; no inline HTML>',
    internal_links: [
      { anchor: '<anchor text>', target_url: '<absolute or relative URL from the suggested list or related articles>' },
    ],
    sources: [
      { claim: '<fact or stat you cited>', source: '<URL or source name>' },
    ],
    notes_for_editor: '<optional: anything the reviewer should know — e.g., gaps, assumptions, uncertainty>',
  }, null, 2));
  sections.push('```');

  const prompt_text = sections.join('\n');
  const hashInput = JSON.stringify({
    v: WRITING_BRIEF_VERSION,
    idea_id: idea.id,
    working_title: idea.working_title,
    content_type: idea.content_type,
    primary_query: idea.primary_query,
    secondary_queries: idea.secondary_queries,
    evidence: idea.evidence,
    site_slug: idea.network_sites.slug,
  });
  const prompt_hash = createHash('sha256').update(hashInput).digest('hex');

  return {
    prompt_text,
    prompt_hash,
    prompt_version: WRITING_BRIEF_VERSION,
    generated_at: new Date().toISOString(),
  };
}
