import 'server-only';

// Production prompt assembler for the Autopilot writer.
//
// Inputs (frozen):
//   - EvidencePackPayload (v2)
//   - ArticleTemplate (section contract)
//   - voice profile (sourced from network_voice_profiles)
//   - writing rules (DRAFT_RULES + banned phrases from pack)
//   - approved internal link candidates (from internal-links engine)
//
// Output: { system, user, prompt_hash, prompt_version, estimated_input_tokens, max_output_tokens }
//
// The assembler is DETERMINISTIC — identical inputs produce identical
// prompt text, so prompt_hash is stable per pack. Checkpoint C's REAL
// executor calls the configured model with exactly this payload.
//
// Fixture + REAL modes consume the same `AssembledPrompt`. Fixture
// renders deterministically from the evidence; REAL sends the prompt
// to the model and parses the structured response via
// output-parser.ts. Both paths produce the same DraftOutput JSON
// shape, which is validated identically.

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvidenceInternalLink, EvidencePackPayload } from './types';
import { getTemplate } from './templates';
import { DRAFT_RULES } from './templates';

export const PROMPT_VERSION = '2026-10-07-b1';

export interface VoiceProfileSnapshot {
  audience: string | null;
  tone: string | null;
  terminology: string | null;
  content_emphasis: string | null;
  preferred_structure: string | null;
  balance: string | null;
  do_not: string | null;
  naming_rules: string | null;
}

export interface AssembledPrompt {
  prompt_version: string;
  prompt_hash: string;                    // sha256(system + '\x1f' + user)
  system: string;
  user: string;
  estimated_input_tokens: number;         // conservative heuristic (chars / 3.5)
  max_output_tokens: number;
  voice_snapshot: VoiceProfileSnapshot;
  approved_link_count: number;
}

export async function loadVoiceSnapshot(sb: SupabaseClient, siteId: string): Promise<VoiceProfileSnapshot> {
  const { data } = await sb
    .from('network_voice_profiles')
    .select('audience, tone, terminology, content_emphasis, preferred_structure, balance, do_not, naming_rules')
    .eq('site_id', siteId)
    .maybeSingle();
  const r = (data as VoiceProfileSnapshot | null) ?? {
    audience: null, tone: null, terminology: null, content_emphasis: null,
    preferred_structure: null, balance: null, do_not: null, naming_rules: null,
  };
  return r;
}

export interface AssembleParams {
  pack: EvidencePackPayload;
  voice: VoiceProfileSnapshot;
  approved_internal_links: EvidenceInternalLink[];
}

export function assemblePrompt(params: AssembleParams): AssembledPrompt {
  const template = getTemplate(params.pack.topic.kind);

  // ─── System prompt ────────────────────────────────────────────
  const system = joinLines([
    `You are a Yu-Gi-Oh! editor at ${params.pack.site.name}. You write short, data-grounded editorial pieces for serious collectors.`,
    '',
    'WRITING RULES',
    ...DRAFT_RULES.map((r) => `  - ${r}`),
    '',
    voiceSection(params.voice),
    '',
    'STRUCTURED OUTPUT',
    'Return a SINGLE JSON object matching the DraftOutput schema. No prose outside the JSON. Required top-level fields: title, meta_title, meta_description, slug, featured_image_source_url, sections. Each section object: id, heading, heading_level (null|2|3), paragraphs (string[]), internal_links (array of {anchor,target_url}), images (array of {source_url,alt_text}).',
    '',
    'TEMPLATE CONTRACT',
    `template: ${template.id} (${template.label}).`,
    'Sections (in order, with evidence slots the section may reference):',
    ...template.sections.map((s) => `  - ${s.id} (${s.required ? 'required' : 'optional'}, H${s.heading_level ?? '-'}): evidence = [${s.evidence.join(', ')}]`),
    '',
    `BANNED PHRASES: ${JSON.stringify(params.pack.generation_constraints.banned_phrases)}`,
    `TARGET WORD COUNT: ${params.pack.generation_constraints.target_word_count_min}-${params.pack.generation_constraints.target_word_count_max} words across all sections combined.`,
  ]);

  // ─── User prompt — the frozen pack + approved links ──────────
  const user = joinLines([
    `Site: ${params.pack.site.slug} (${params.pack.site.name})`,
    `Working title: ${params.pack.topic.working_title}`,
    `Primary query (if any): ${params.pack.topic.primary_query ?? '(none)'}`,
    `Secondary queries: ${JSON.stringify(params.pack.topic.secondary_queries)}`,
    `Date range: ${params.pack.date_range.from} to ${params.pack.date_range.to}`,
    '',
    'ARTICLE ANGLE',
    `  anchor: ${params.pack.article_angle.anchor}`,
    `  one line: ${params.pack.article_angle.one_line}`,
    `  must cover: ${JSON.stringify(params.pack.article_angle.must_cover)}`,
    `  must NOT cover: ${JSON.stringify(params.pack.article_angle.must_not_cover)}`,
    `  dominant source tier: ${params.pack.article_angle.dominant_tier}`,
    '',
    'METHODOLOGY',
    params.pack.methodology,
    '',
    'EVIDENCE PACK (JSON) — the ONLY factual input you may use:',
    JSON.stringify({
      market_data:       params.pack.market_data,
      search_data:       params.pack.search_data,
      related_pages:     params.pack.related_pages,
      existing_content:  params.pack.existing_content,
      images:            params.pack.images,
      commercial_links:  params.pack.commercial_links,
      external_sources:  params.pack.external_sources,
    }),
    '',
    'APPROVED INTERNAL LINKS (use natural anchors drawn from each entry\'s anchor_concepts; never link the same target twice):',
    JSON.stringify(params.approved_internal_links),
    '',
    `Return the DraftOutput JSON now. Nothing else.`,
  ]);

  const prompt_hash = crypto.createHash('sha256').update(system).update('\x1f').update(user).digest('hex');
  const estimated_input_tokens = Math.ceil((system.length + user.length) / 3.5);

  return {
    prompt_version: PROMPT_VERSION,
    prompt_hash,
    system,
    user,
    estimated_input_tokens,
    max_output_tokens: params.pack.generation_constraints.max_output_tokens,
    voice_snapshot: params.voice,
    approved_link_count: params.approved_internal_links.length,
  };
}

function voiceSection(v: VoiceProfileSnapshot): string {
  const bits: string[] = ['VOICE'];
  if (v.audience)           bits.push(`  Audience: ${v.audience}`);
  if (v.tone)               bits.push(`  Tone: ${v.tone}`);
  if (v.terminology)        bits.push(`  Terminology: ${v.terminology}`);
  if (v.content_emphasis)   bits.push(`  Emphasis: ${v.content_emphasis}`);
  if (v.preferred_structure) bits.push(`  Preferred structure: ${v.preferred_structure}`);
  if (v.balance)            bits.push(`  Balance: ${v.balance}`);
  if (v.do_not)             bits.push(`  Do not: ${v.do_not}`);
  if (v.naming_rules)       bits.push(`  Naming rules: ${v.naming_rules}`);
  return bits.length === 1
    ? 'VOICE\n  (no voice profile persisted for this site — writer should use clear, factual, collector-focused prose; no filler.)'
    : bits.join('\n');
}

function joinLines(lines: string[]): string {
  return lines.join('\n');
}
