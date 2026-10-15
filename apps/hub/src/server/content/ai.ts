import 'server-only';

// Anthropic Claude integration for Phase 3 content generation.
//
// Scope: brief + draft generation only. Prompt caching is used for
// the per-site voice profile (reused across many briefs) so cost
// stays low. Server-only — the API key never ships to the browser.
//
// Model: Haiku 4.5 (claude-haiku-4-5-20251001) is the Slice A
// default. The actual model identifier comes from
// network_autopilot_config.default_draft_model so an operator can
// swap it without a deploy. Haiku-4.5 keeps a brief + draft pair
// well under $0.05 — critical for the $1 / 7-day rolling budget.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDraftModel } from './budget';

// Per-model USD/MTok rates. Keep every model we might configure so
// cost accounting stays accurate if an operator flips the config.
// Prices as of 2026-10 (Anthropic pricing page).
const MODEL_PRICING: Record<string, { input: number; output: number; cache_read: number; cache_write: number }> = {
  // Haiku 4.5
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4,    cache_read: 0.08, cache_write: 1 },
  'claude-haiku-4-5':          { input: 0.80, output: 4,    cache_read: 0.08, cache_write: 1 },
  // Sonnet 4.6 (fallback)
  'claude-sonnet-4-6':          { input: 3,    output: 15,   cache_read: 0.30, cache_write: 3.75 },
  // Opus 4.7 (not used by Slice A; kept so prior cost-log rows reconcile)
  'claude-opus-4-7':            { input: 15,   output: 75,   cache_read: 1.5,  cache_write: 18.75 },
};

const DEFAULT_HAIKU = 'claude-haiku-4-5-20251001';

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  est_cost_usd: number;
  model: string;
}

function estimateCost(usage: Anthropic.Usage, model: string): AiUsage {
  const input         = usage.input_tokens         ?? 0;
  const output        = usage.output_tokens        ?? 0;
  const cacheRead     = usage.cache_read_input_tokens ?? 0;
  const cacheWrite    = usage.cache_creation_input_tokens ?? 0;
  const price = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_HAIKU]!;
  const cost =
    (input * price.input +
     output * price.output +
     cacheRead * price.cache_read +
     cacheWrite * price.cache_write) / 1_000_000;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    est_cost_usd: Number(cost.toFixed(6)),
    model,
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
  sb: SupabaseClient;
}): Promise<{ brief: GeneratedBrief; usage: AiUsage; rawText: string }> {
  const client = getAnthropic();
  const modelCfg = await loadDraftModel(args.sb);
  const briefModel = modelCfg.model;

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
    model: briefModel,
    // Haiku-4.5 caps at 8192 output tokens; keep brief budget wide
    // enough for data-heavy evidence packs.
    max_tokens: Math.min(modelCfg.max_output_tokens, 4000),
    system: systemBlocks,
    messages: [{
      role: 'user',
      content: `Generate the brief as JSON per the schema. Evidence:\n\n${JSON.stringify(userPayload, null, 2)}`,
    }],
  });

  const rawText = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n').trim();
  if (res.stop_reason === 'max_tokens') {
    const err = new Error(`[brief] AI output hit max_tokens (${res.usage.output_tokens} tokens). Increase max_tokens or shrink the evidence payload. First 200 chars: ${rawText.slice(0, 200)}`);
    console.error(err.message);
    throw err;
  }
  let brief: GeneratedBrief;
  try {
    brief = parseBriefJson(rawText);
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[brief] parse failure: ${msg}. Raw output length=${rawText.length}. First 400 chars: ${rawText.slice(0, 400)}... Last 400: ${rawText.slice(-400)}`);
    throw new Error(`AI returned non-JSON: ${msg}. Output length ${rawText.length} chars. stop_reason=${res.stop_reason}. First 200 chars: ${rawText.slice(0, 200)}`);
  }
  return { brief, usage: estimateCost(res.usage, briefModel), rawText };
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

export async function generateDraft(args: DraftInput & { sb: SupabaseClient }): Promise<{ draft: GeneratedDraft; usage: AiUsage; rawText: string }> {
  const client = getAnthropic();
  const modelCfg = await loadDraftModel(args.sb);
  const draftModel = modelCfg.model;

  const system = [
    voiceSystemBlock(args.siteSlug, args.voice),
    ``,
    `DRAFT PHASE SPECIFIC RULES`,
    `• Write the article in Markdown. Use # H1, ## H2, ### H3.`,
    `• Follow the brief's outline. Do not add sections the brief didn't request.`,
    `• You MAY only cite facts from the supplied brief required_facts and additional_facts. Anything outside those lists must be flagged in research_gaps rather than written as a claim.`,
    `• Use internal links only from the "accepted" entries in internal_link_slate. Use the exact target_url and anchor. Do not invent URLs.`,
    `• No hyperbole. No "revolutionary", "ultimate", "world-class", "game-changer", "must-have", "unprecedented".`,
    `• Match the site voice canonical tag + naming rules precisely.`,
    `• Do not fabricate prices, dates, rules, counts, pull rates, quotes, or firsthand experiences ("I remember…", "we tested…").`,
    `• Do not claim market trends unless an explicit price-data fact supports them. Phrases like "the market is heating up", "prices are rising", "demand is surging" are banned unless the brief or additional_facts provide the number.`,
    ``,
    `BANNED PROSE PATTERNS — the operator will reject the article on sight if these appear:`,
    `• EM DASHES (— or –). Use commas, parentheses, or two short sentences instead. Hyphens inside compound words are fine.`,
    `• Formulaic AI openers: "In the world of…", "In today's…", "In the ever-evolving…", "Welcome to…", "Have you ever wondered…", "Picture this…", "Let's dive into…", "When it comes to…".`,
    `• Formulaic AI closers: "In conclusion…", "At the end of the day…", "The bottom line is…", "Only time will tell…".`,
    `• Two consecutive sentences starting with the same word.`,
    `• Keyword stuffing. The primary query should appear once in the H1, once in the first ~150 words, and otherwise only where natural. Do not repeat it in every H2.`,
    `• Padding sentences that restate the previous one. Length comes from substance, never from filler.`,
    `• Generic encyclopaedia tone when the brief calls for specifics. If the brief gives you numbers, use them.`,
    ``,
    `STRUCTURE VARIATION`,
    `• Do not open every article with a lede + outline + numbered list. Vary — pick the structure that fits the brief (data-first table, Q&A, chronological, problem/solution, comparison).`,
    `• If the brief has 3+ required_facts that are numeric, consider a table (markdown pipe syntax).`,
    `• If internal_link_slate has 3+ accepted entries, weave them throughout — not all in one "related reading" block.`,
    ``,
    `RESEARCH GAPS`,
    `• If a brief required_fact lacks a verifiable source in additional_facts, append a research_gap entry "RESEARCH REQUIRED: <specific question>" and OMIT the claim from the body. The operator can fill the gap and republish.`,
    `• Prefer flagging a gap over writing a weak sentence that pads around it.`,
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
    model: draftModel,
    // Haiku-4.5 caps at 8192 output tokens. Respect the configured
    // max (operator can lower it to save budget) but hard-cap at
    // 8000 — the ESTIMATED_COST_USD.draft ceiling is sized for that.
    max_tokens: Math.min(modelCfg.max_output_tokens, 8000),
    system: systemBlocks,
    messages: [{
      role: 'user',
      content: `Write the article as JSON per the format rules. Context:\n\n${JSON.stringify(userPayload, null, 2)}`,
    }],
  });

  const rawText = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n').trim();
  if (res.stop_reason === 'max_tokens') {
    const err = new Error(`[draft] AI output hit max_tokens (${res.usage.output_tokens} tokens). Increase max_tokens or shrink the brief payload. First 200 chars: ${rawText.slice(0, 200)}`);
    console.error(err.message);
    throw err;
  }
  let draft: GeneratedDraft;
  try {
    draft = parseDraftJson(rawText);
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[draft] parse failure: ${msg}. Raw output length=${rawText.length}. First 400 chars: ${rawText.slice(0, 400)}... Last 400: ${rawText.slice(-400)}`);
    throw new Error(`AI returned non-JSON: ${msg}. Output length ${rawText.length} chars. stop_reason=${res.stop_reason}. First 200 chars: ${rawText.slice(0, 200)}`);
  }
  return { draft, usage: estimateCost(res.usage, draftModel), rawText };
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
