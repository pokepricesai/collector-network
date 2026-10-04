import 'server-only';

// AI social drafter + editorial QC (semantic reviewer).
//
// Reuses the Phase 3 Anthropic SDK wrapper patterns from
// src/server/content/ai.ts — same cost accounting, same prompt-
// caching for the voice profile, same JSON-only output contract.
//
// Social voice is deliberately NOT the article voice. Articles are
// polished editorial; social is lightly conversational. See the
// seeded network_social_voice_profiles row for the primary account.

import Anthropic from '@anthropic-ai/sdk';

const DRAFT_MODEL = 'claude-opus-4-7';
const QC_MODEL = 'claude-opus-4-7';

const PRICE_PER_MTOK = { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 };

export interface AiUsage {
  input_tokens: number; output_tokens: number;
  cache_read_tokens: number; cache_write_tokens: number;
  est_cost_usd: number; model: string;
}

function estimateCost(usage: Anthropic.Usage, model: string): AiUsage {
  const input      = usage.input_tokens      ?? 0;
  const output     = usage.output_tokens     ?? 0;
  const cacheRead  = usage.cache_read_input_tokens     ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cost = (input * PRICE_PER_MTOK.input
    + output * PRICE_PER_MTOK.output
    + cacheRead * PRICE_PER_MTOK.cache_read
    + cacheWrite * PRICE_PER_MTOK.cache_write) / 1_000_000;
  return {
    input_tokens: input, output_tokens: output,
    cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite,
    est_cost_usd: Number(cost.toFixed(6)), model,
  };
}

function getClient(): Anthropic {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set — social AI is disabled until the key is provisioned.');
  return new Anthropic({ apiKey: key });
}

// =============================================================
// SOCIAL DRAFT GENERATOR
// =============================================================

export interface SocialVoice {
  label: string;
  audience: string;
  tone: string;
  terminology: string;
  do_not: string;
  content_mix: Record<string, number>;
  example_posts: string[];
  example_antipatterns: string[];
}

export interface SocialEvidence {
  idea: {
    working_title: string;
    summary: string | null;
    post_type: string;
    origin_type: string;
    evidence: Record<string, unknown>;
  };
  source_article?: {
    title: string;
    slug: string;
    publication_url: string | null;
    summary: string | null;
    primary_query: string | null;
  } | null;
  pricing_fact?: Record<string, unknown> | null;    // one specific mover
  brief_notable?: Record<string, unknown> | null;
  objective: string;                                // "share article", "flag market mover", etc.
}

export interface GeneratedSocialDraft {
  primary_text: string;                             // standalone post
  thread?: string[];                                // optional ordered thread
  alternative_text?: string;                        // optional second variant
  links_used: string[];
  evidence_cited: string[];
  research_gaps: string[];
}

function voiceSystem(voice: SocialVoice, platform: 'x'): string {
  return [
    `You are the voice of ${voice.label}.`,
    ``,
    `AUDIENCE: ${voice.audience}`,
    `TONE: ${voice.tone}`,
    `TERMINOLOGY: ${voice.terminology}`,
    `DO NOT: ${voice.do_not}`,
    `CONTENT MIX GUARDRAIL (loose, do not enforce rigidly): ${JSON.stringify(voice.content_mix)}`,
    ``,
    `GOOD EXAMPLES (style reference, do not copy):`,
    ...voice.example_posts.map((s, i) => `${i + 1}. "${s}"`),
    ``,
    `ANTI-PATTERNS (never produce output that looks like these):`,
    ...voice.example_antipatterns.map((s, i) => `${i + 1}. "${s}"`),
    ``,
    `CORE RULES`,
    `• Platform: ${platform.toUpperCase()}. Keep each standalone post under 280 characters.`,
    `• Never invent prices, release dates, pop reports, auction results, rules changes, or publisher announcements. Only state facts supplied in the evidence block.`,
    `• If evidence is insufficient to make a claim, add that claim to research_gaps rather than guessing.`,
    `• At most one short hashtag per post, only if contextually relevant. Prefer no hashtag.`,
    `• At most one or two emojis per post, used sparingly. Not required.`,
    `• No "🚨 ALERT 🚨" or similar engagement-bait framing.`,
    `• No price predictions, no "buy/sell" signals, no "mooning" / "crashed" / "bubble" language.`,
    `• No vanity-stat spam ("the network just hit X!").`,
    `• Links: at most one link per post. The link URL must be from the supplied evidence; never fabricate a URL.`,
    `• Thread version is OPTIONAL. Only produce one if the content truly needs more than 280 chars to be honest and the parts stand on their own.`,
    ``,
    `OUTPUT FORMAT`,
    `Return ONLY a JSON object. No prose outside, no markdown fences:`,
    `{`,
    `  "primary_text": "the post, <=280 chars",`,
    `  "thread": ["post 1", "post 2", ...] | null,`,
    `  "alternative_text": "optional second variant, <=280 chars" | null,`,
    `  "links_used": ["https://..."] (zero or one),`,
    `  "evidence_cited": ["the exact evidence fact(s) this post rests on"],`,
    `  "research_gaps": ["RESEARCH REQUIRED: ..."] | []`,
    `}`,
  ].join('\n');
}

export async function generateSocialDraft(args: {
  voice: SocialVoice;
  evidence: SocialEvidence;
  wantThread?: boolean;
}): Promise<{ draft: GeneratedSocialDraft; usage: AiUsage; rawText: string }> {
  const client = getClient();
  const system = voiceSystem(args.voice, 'x');
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];
  const userPayload = {
    task: 'generate_social_post',
    objective: args.evidence.objective,
    want_thread: !!args.wantThread,
    idea: args.evidence.idea,
    source_article: args.evidence.source_article ?? null,
    pricing_fact: args.evidence.pricing_fact ?? null,
    brief_notable: args.evidence.brief_notable ?? null,
  };
  const res = await client.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 2000,
    system: systemBlocks,
    messages: [{ role: 'user', content: `Draft the social post. Evidence:\n\n${JSON.stringify(userPayload, null, 2)}` }],
  });
  const rawText = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n').trim();
  if (res.stop_reason === 'max_tokens') {
    throw new Error(`[social-draft] hit max_tokens. First 200 chars: ${rawText.slice(0, 200)}`);
  }
  let draft: GeneratedSocialDraft;
  try { draft = parseSocialJson(rawText); }
  catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[social-draft] parse failure: ${msg}. First 400: ${rawText.slice(0, 400)}`);
    throw new Error(`AI returned non-JSON: ${msg}. First 200: ${rawText.slice(0, 200)}`);
  }
  if (draft.primary_text.length > 280) {
    throw new Error(`[social-draft] primary text ${draft.primary_text.length} chars exceeds X limit (280)`);
  }
  return { draft, usage: estimateCost(res.usage, DRAFT_MODEL), rawText };
}

function parseSocialJson(raw: string): GeneratedSocialDraft {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1]!.trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const parsed = JSON.parse(s) as GeneratedSocialDraft;
  if (!parsed.primary_text || typeof parsed.primary_text !== 'string') {
    throw new Error('AI social parse: missing primary_text');
  }
  return parsed;
}

// =============================================================
// EDITORIAL AI QC (semantic reviewer for articles + social posts)
// =============================================================

export interface EditorialQcIssue {
  code: string;
  severity: 'blocker' | 'warning' | 'suggestion';
  category: string;                                 // 'unsupported_claim' | 'table_completeness' | 'ordering' | ...
  message: string;
  location?: string;                                // free-text pointer: "Raw risers table row 2"
  suggested_fix?: string;
}

export interface EditorialQcResult {
  issues: EditorialQcIssue[];
  summary: string;
  checked_against: string[];
}

export async function runEditorialQcOnArticle(args: {
  article: { title: string; slug: string; body: string; summary: string | null; meta_title: string | null; meta_description: string | null };
  brief: Record<string, unknown>;
  evidenceFacts: Array<{ claim: string; source: string }>;
  siteVoiceLabel: string;
}): Promise<{ result: EditorialQcResult; usage: AiUsage; rawText: string }> {
  const client = getClient();
  const system = [
    `You are the EDITORIAL QC reviewer for the Collector Network. Target site: ${args.siteVoiceLabel}.`,
    ``,
    `You review a DRAFTED article against (a) its approved brief, and (b) the evidence facts the drafter was authorised to cite. You do NOT rewrite — you produce a list of SPECIFIC, ACTIONABLE issues.`,
    ``,
    `CHECK FOR`,
    `• unsupported_claim        — a factual statement not grounded in the brief or evidence facts`,
    `• internal_contradiction   — the article contradicts itself`,
    `• table_completeness       — a table has multiple empty cells (—) where the evidence facts contain the data`,
    `• table_row_merging        — two distinct cards or entities merged into one row, losing information`,
    `• raw_vs_graded_confusion  — raw and graded figures conflated or mislabelled`,
    `• methodology_contradiction — body violates the methodology section's own rules`,
    `• awkward_repetition       — same sentence structure or fact repeated inefficiently`,
    `• incomplete_presentation  — fewer rows shown in a table than claimed in the headline ("Top 5" but only 2 rows have numbers)`,
    `• incorrect_link           — a link URL that doesn't resolve to the referenced entity or doesn't match the evidence URL`,
    `• excessive_certainty      — "will", "guaranteed", "always", "the biggest ever" without evidence`,
    `• investment_advice        — any "buy", "sell", "hold", "undervalued", "overvalued" framing`,
    `• weak_conclusion          — the article's close doesn't add any insight or restates the lede`,
    `• unsupported_causation    — attributing a price move to an event / grade / release / influencer without a cited source`,
    `• inconsistent_ordering    — a "top N by X" table where rows are not actually ordered by X`,
    ``,
    `SEVERITY`,
    `• blocker    — must fix before publication. Factual errors, unsupported causation, investment advice, incorrect links.`,
    `• warning    — should fix. Table incompleteness, merged rows, ordering inconsistency, methodology contradiction.`,
    `• suggestion — nice to fix. Weak conclusions, awkward repetition.`,
    ``,
    `RULES`,
    `• Be specific. Point at the exact section, row, or claim. "Raw risers table" > "the article".`,
    `• Only cite the article; do not propose rewrites in the message.`,
    `• An empty "—" cell in a table is only an issue if the evidence facts contain the data that could have filled it. Check before flagging.`,
    `• Do not fabricate issues to pad the list. If the article is clean, return few or zero issues.`,
    ``,
    `OUTPUT FORMAT`,
    `Return ONLY a JSON object. No prose outside, no markdown fences:`,
    `{`,
    `  "issues": [{ "code": "...", "severity": "blocker"|"warning"|"suggestion", "category": "...", "message": "...", "location": "...", "suggested_fix": "..." }],`,
    `  "summary": "one-sentence overall assessment",`,
    `  "checked_against": ["brief", "evidence_facts"]`,
    `}`,
  ].join('\n');
  const userPayload = {
    article: args.article,
    brief: args.brief,
    evidence_facts: args.evidenceFacts,
  };
  const res = await client.messages.create({
    model: QC_MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Review this article. Return JSON per schema.\n\n${JSON.stringify(userPayload, null, 2)}` }],
  });
  const rawText = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n').trim();
  if (res.stop_reason === 'max_tokens') {
    throw new Error(`[editorial-qc] hit max_tokens. First 200: ${rawText.slice(0, 200)}`);
  }
  let result: EditorialQcResult;
  try { result = parseQcJson(rawText); }
  catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[editorial-qc] parse failure: ${msg}. First 400: ${rawText.slice(0, 400)}`);
    throw new Error(`QC AI returned non-JSON: ${msg}. First 200: ${rawText.slice(0, 200)}`);
  }
  return { result, usage: estimateCost(res.usage, QC_MODEL), rawText };
}

function parseQcJson(raw: string): EditorialQcResult {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1]!.trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const parsed = JSON.parse(s) as EditorialQcResult;
  if (!Array.isArray(parsed.issues)) throw new Error('QC parse: issues not array');
  return parsed;
}

// Shared cost logger (reuses network_ai_cost_log).
export async function logSocialAiCost(
  sb: import('@supabase/supabase-js').SupabaseClient,
  args: {
    operation: 'social_draft' | 'thread_draft' | 'editorial_qc' | 'newsletter_draft' | 'refresh_brief';
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
