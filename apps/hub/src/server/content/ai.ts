import 'server-only';

// Anthropic Claude integration for Phase 3 content generation.
//
// Scope: brief + draft generation only. Prompt caching is used for
// the per-site voice profile (reused across many briefs) so cost
// stays low. Server-only — the API key never ships to the browser.
//
// Model: claude-opus-4-6 for both operations. Opus is required for
// the structured-brief outputs (nested JSON matching our brief
// schema) and the site-voice fidelity.

import Anthropic from '@anthropic-ai/sdk';

const BRIEF_MODEL = 'claude-opus-4-6';
const DRAFT_MODEL = 'claude-opus-4-6';

// Opus pricing (as of 2026-02): $15/MTok input, $75/MTok output,
// cache read $1.50/MTok, cache write $18.75/MTok. We track this on
// network_ai_cost_log alongside token counts.
const PRICE_PER_MTOK = {
  input: 15,
  output: 75,
  cache_read: 1.5,
  cache_write: 18.75,
};

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  est_cost_usd: number;
  model: string;
}

function estimateCost(usage: Anthropic.Usage): AiUsage {
  const input         = usage.input_tokens         ?? 0;
  const output        = usage.output_tokens        ?? 0;
  const cacheRead     = usage.cache_read_input_tokens ?? 0;
  const cacheWrite    = usage.cache_creation_input_tokens ?? 0;
  const cost =
    (input * PRICE_PER_MTOK.input +
     output * PRICE_PER_MTOK.output +
     cacheRead * PRICE_PER_MTOK.cache_read +
     cacheWrite * PRICE_PER_MTOK.cache_write) / 1_000_000;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    est_cost_usd: Number(cost.toFixed(6)),
    model: 'claude-opus-4-6',
  };
}

export function getAnthropic(): Anthropic {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in this environment. Set it in Vercel project settings (Production) to enable AI content generation.');
  return new Anthropic({ apiKey: key });
}

// ============================================================
// BRIEF GENERATOR
// ============================================================

export interface VoiceProfile {
  audience: string;
  tone: string;
  terminology: string;
  content_emphasis: string;
  preferred_structure: string | null;
  balance: string | null;
  do_not: string;
  naming_rules: string;
  canonical_tag: string;
  example_openings: string[];
}

export interface BriefEvidence {
  idea: {
    working_title: string;
    primary_query: string | null;
    secondary_queries: string[];
    content_type: string;
    summary: string | null;
    origin_type: string;
    evidence: Record<string, unknown>;
  };
  gsc_context: {
    related_queries: Array<{ query: string; impressions: number; clicks: number; position: number | null }>;
    ranking_pages: Array<{ page: string; clicks: number; impressions: number }>;
  };
  internal_link_targets: Array<{ target_url: string; reason: string; evidence?: Record<string, unknown> }>;
  existing_articles: Array<{ title: string; url: string; summary?: string }>;
}

export interface GeneratedBrief {
  purpose: string;
  reader_intent: string;
  primary_query: string;
  secondary_queries: string[];
  evidence_summary: string;
  recommended_angle: string;
  outline: Array<{ h2: string; h3s?: string[]; notes?: string }>;
  suggested_h1: string;
  required_facts: string[];
  entities_to_mention: string[];
  suggested_internal_links: Array<{ target_url: string; anchor: string; reason: string }>;
  external_source_requirements: string[];
  seo_notes: string;
  suggested_meta_title: string;
  suggested_meta_description: string;
  suggested_schema_type: string;
  things_not_to_claim: string[];
  freshness_requirements: string;
  research_gaps: string[];
}

function voiceSystemBlock(site: string, voice: VoiceProfile): string {
  return [
    `You are the editorial content strategist for ${site} (one of five Collector Network sites).`,
    ``,
    `SITE VOICE (${site})`,
    `Audience: ${voice.audience}`,
    `Tone: ${voice.tone}`,
    `Terminology: ${voice.terminology}`,
    `Content emphasis: ${voice.content_emphasis}`,
    voice.preferred_structure ? `Preferred structure: ${voice.preferred_structure}` : '',
    voice.balance ? `Balance: ${voice.balance}` : '',
    `Naming rules: ${voice.naming_rules}`,
    `Canonical tag: ${voice.canonical_tag}`,
    `Do NOT: ${voice.do_not}`,
    voice.example_openings.length > 0 ? `Example openings (style reference): ${voice.example_openings.map((o) => `"${o}"`).join('; ')}` : '',
    ``,
    `CORE RULES — these are hard constraints and apply everywhere.`,
    `• You are producing a structured BRIEF. The brief is a plan, not an article.`,
    `• Never invent prices, release dates, rules, pull rates, quotes, announcements, search volumes, or sources.`,
    `• If the evidence is insufficient to make a factual claim, add it to research_gaps as "RESEARCH REQUIRED: …" rather than guessing.`,
    `• Keep every claim grounded in the provided evidence block.`,
    `• Internal-link suggestions must come ONLY from the provided internal_link_targets list.`,
    `• things_not_to_claim should list the specific unsupported claims a less-careful writer might slip in — the forbidden list the drafter will later check against.`,
    `• required_facts should list verifiable data points the article MUST include (e.g. "LOB release date (research_required)" or "live top-3 chase cards from PokePrices feed").`,
    ``,
    `OUTPUT FORMAT`,
    `Return ONLY a single JSON object matching the brief schema. No prose outside the JSON. No markdown fences. No commentary.`,
    `All string fields: concise, scannable, no filler.`,
    `outline: 3–6 H2 sections. Each may carry H3s. Order matters.`,
  ].filter(Boolean).join('\n');
}

const BRIEF_SCHEMA_SNIPPET = `
{
  "purpose": "one sentence — why we are writing this",
  "reader_intent": "one sentence — what the reader is looking for",
  "primary_query": "exact target query",
  "secondary_queries": ["adjacent queries"],
  "evidence_summary": "2-4 sentences grounding the brief in the supplied evidence",
  "recommended_angle": "the editorial angle",
  "outline": [
    { "h2": "section title", "h3s": ["subsection"], "notes": "what belongs here" }
  ],
  "suggested_h1": "actual H1 string",
  "required_facts": ["bulleted factual data points the article must include"],
  "entities_to_mention": ["cards / sets / characters / topics to reference"],
  "suggested_internal_links": [
    { "target_url": "https://...", "anchor": "...", "reason": "..." }
  ],
  "external_source_requirements": ["things we may need to research outside our data"],
  "seo_notes": "concise SEO notes — intent match, CTR angle, SERP context",
  "suggested_meta_title": "<= 60 chars",
  "suggested_meta_description": "<= 160 chars",
  "suggested_schema_type": "Article | FAQPage | HowTo | ...",
  "things_not_to_claim": ["unsupported claims the drafter must avoid"],
  "freshness_requirements": "how often this content needs refresh and what triggers it",
  "research_gaps": ["RESEARCH REQUIRED: ..."]
}`.trim();

export async function generateBrief(args: {
  siteSlug: string;
  voice: VoiceProfile;
  evidence: BriefEvidence;
}): Promise<{ brief: GeneratedBrief; usage: AiUsage; rawText: string }> {
  const client = getAnthropic();

  const system = voiceSystemBlock(args.siteSlug, args.voice);
  // Cache the system block (voice profile + rules) — it's reused
  // across every brief for this site, which is a very good cache
  // hit pattern.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `SCHEMA\n\n${BRIEF_SCHEMA_SNIPPET}` },
  ];

  const userPayload = {
    task: 'generate_brief',
    content_type: args.evidence.idea.content_type,
    idea: args.evidence.idea,
    gsc_context: args.evidence.gsc_context,
    internal_link_candidates: args.evidence.internal_link_targets,
    existing_articles: args.evidence.existing_articles,
  };

  const res = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 4000,
    system: systemBlocks,
    messages: [{
      role: 'user',
      content: `Generate the brief as JSON per the schema. Evidence:\n\n${JSON.stringify(userPayload, null, 2)}`,
    }],
  });

  const rawText = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n').trim();
  const brief = parseBriefJson(rawText);
  return { brief, usage: estimateCost(res.usage), rawText };
}

function parseBriefJson(raw: string): GeneratedBrief {
  // Strip accidental markdown fences and leading commentary.
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1]!.trim();
  // Find the outermost {...} if there's any leading text.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const parsed = JSON.parse(s) as GeneratedBrief;
  if (!parsed.suggested_h1 || !Array.isArray(parsed.outline)) {
    throw new Error('AI brief parse: missing required fields (suggested_h1 or outline)');
  }
  return parsed;
}

// ============================================================
// DRAFT GENERATOR
// ============================================================

export interface DraftInput {
  siteSlug: string;
  voice: VoiceProfile;
  brief: GeneratedBrief;
  internal_link_slate: Array<{ target_url: string; anchor: string; reason: string; accepted: boolean }>;
  additional_facts?: Array<{ claim: string; source: string }>;
}

export interface GeneratedDraft {
  title: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  summary: string;
  body_markdown: string;
  used_internal_links: Array<{ target_url: string; anchor: string }>;
  sources: Array<{ claim: string; source: string }>;
  research_gaps: string[];
}

export async function generateDraft(args: DraftInput): Promise<{ draft: GeneratedDraft; usage: AiUsage; rawText: string }> {
  const client = getAnthropic();

  const system = [
    voiceSystemBlock(args.siteSlug, args.voice),
    ``,
    `DRAFT PHASE SPECIFIC RULES`,
    `• Write the article in Markdown. Use # H1, ## H2, ### H3.`,
    `• Follow the brief's outline. Do not add sections the brief didn't request.`,
    `• You MAY only cite facts from the supplied brief required_facts and additional_facts. Anything outside those lists must be flagged in research_gaps rather than written as a claim.`,
    `• Use internal links only from the "accepted" entries in internal_link_slate. Use the exact target_url and anchor. Do not invent URLs.`,
    `• No hyperbole. No "revolutionary", "ultimate", "world-class".`,
    `• Match the site voice canonical tag + naming rules precisely.`,
    `• Do not fabricate prices, dates, rules, counts, pull rates, or quotes.`,
    ``,
    `OUTPUT FORMAT`,
    `Return ONLY a single JSON object:`,
    `{`,
    `  "title": "...", "slug": "kebab-case", "meta_title": "<=60 chars", "meta_description": "<=160 chars",`,
    `  "summary": "1-2 sentence summary", "body_markdown": "the article",`,
    `  "used_internal_links": [{ "target_url": "...", "anchor": "..." }],`,
    `  "sources": [{ "claim": "...", "source": "..." }],`,
    `  "research_gaps": ["RESEARCH REQUIRED: ..."]`,
    `}`,
    `No prose outside the JSON. No markdown fences around the JSON.`,
  ].join('\n');

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];

  const userPayload = {
    task: 'generate_draft',
    brief: args.brief,
    internal_link_slate: args.internal_link_slate,
    additional_facts: args.additional_facts ?? [],
  };

  const res = await client.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 8000,
    system: systemBlocks,
    messages: [{
      role: 'user',
      content: `Write the article as JSON per the format rules. Context:\n\n${JSON.stringify(userPayload, null, 2)}`,
    }],
  });

  const rawText = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n').trim();
  const draft = parseDraftJson(rawText);
  return { draft, usage: estimateCost(res.usage), rawText };
}

function parseDraftJson(raw: string): GeneratedDraft {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1]!.trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const parsed = JSON.parse(s) as GeneratedDraft;
  if (!parsed.title || !parsed.body_markdown || !parsed.slug) {
    throw new Error('AI draft parse: missing required fields');
  }
  return parsed;
}

// --- Cost logging helper ---------------------------------------
export async function logAiCost(
  sb: import('@supabase/supabase-js').SupabaseClient,
  args: {
    operation: 'brief' | 'draft' | 'revision' | 'summary';
    usage: AiUsage;
    article_id?: string;
    brief_id?: string;
    idea_id?: string;
    actor_user_id?: string;
  },
): Promise<void> {
  await sb.from('network_ai_cost_log').insert({
    operation: args.operation,
    provider: 'anthropic',
    model: args.usage.model,
    article_id: args.article_id ?? null,
    brief_id: args.brief_id ?? null,
    idea_id: args.idea_id ?? null,
    input_tokens: args.usage.input_tokens,
    output_tokens: args.usage.output_tokens,
    cache_read_tokens: args.usage.cache_read_tokens,
    cache_write_tokens: args.usage.cache_write_tokens,
    est_cost_usd: args.usage.est_cost_usd,
    actor_user_id: args.actor_user_id ?? null,
  });
}
