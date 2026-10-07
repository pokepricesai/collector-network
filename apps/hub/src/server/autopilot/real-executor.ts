import 'server-only';

// REAL Autopilot model execution — Anthropic Messages API.
//
// Called ONLY from the admin-approved paid-run server action. The
// executor:
//
//   1. Hits Anthropic with the assembled system+user prompt.
//   2. Parses the response through the SAME parseDraftJson used by
//      fixture mode — zero shortcut for the real path.
//   3. Computes actual cost from real token usage + the pricing in
//      MODEL_PRICING. Throws if the model isn't registered.
//   4. Returns ModelExecutionResult with real tokens, cost_usd,
//      draft, and latency.
//
// NO automatic retry. NO fallback-model escalation. NO semantic-QA
// call. Failures bubble up so the caller can release the budget
// reservation and surface the exact reason to the operator.

import Anthropic from '@anthropic-ai/sdk';
import type { AssembledPrompt } from './prompt';
import { parseDraftJson } from './output-parser';
import { estimateCostUsd, MODEL_PRICING, type ModelPricing } from './models';
import type { ModelExecutionResult } from './types';

export interface RealExecuteParams {
  prompt: AssembledPrompt;
  provider: string;
  model: string;
}

export async function executeRealDraft(params: RealExecuteParams): Promise<ModelExecutionResult> {
  const t0 = Date.now();
  const pricing: ModelPricing | undefined = MODEL_PRICING[params.model];
  if (!pricing) {
    throw new Error(`No pricing registered for model "${params.model}" in MODEL_PRICING. Refusing to run — spend would be unaccounted.`);
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY missing in server env. Configure it in Vercel.');
  }

  const client = new Anthropic({ apiKey });

  // Single call. No retry. No streaming — we want the full JSON in
  // one shot so parseDraftJson can validate it atomically.
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.prompt.max_output_tokens,
    system: params.prompt.system,
    messages: [{ role: 'user', content: params.prompt.user }],
  });

  // Extract text content. Anthropic returns a content array; we only
  // handle the first `text` block (that's the structured JSON) and
  // ignore any tool_use / thinking blocks that may appear.
  const textParts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    }
  }
  const rawText = textParts.join('');

  // The prompt says "Return a SINGLE JSON object". If the model added
  // any preamble/postamble, strip it to the outermost JSON braces
  // BEFORE parsing — the parser itself is strict and will reject
  // anything else. If no braces are found we hand the raw text over
  // so the parser produces a clean error message.
  const jsonSlice = extractJsonObject(rawText) ?? rawText;

  const parsed = parseDraftJson(jsonSlice);
  if (!parsed.ok) {
    throw new Error(
      `Real draft JSON failed schema validation: ${parsed.errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }

  const tokens = {
    input:       response.usage.input_tokens ?? 0,
    output:      response.usage.output_tokens ?? 0,
    cache_read:  response.usage.cache_read_input_tokens ?? 0,
    cache_write: response.usage.cache_creation_input_tokens ?? 0,
  };
  const cost_usd = estimateCostUsd(pricing, tokens);

  return {
    mode: 'real',
    model: params.model,
    provider: params.provider,
    tokens,
    cost_usd,
    draft: parsed.draft,
    latency_ms: Date.now() - t0,
  };
}

// Finds the OUTERMOST JSON object in a string. Returns the exact
// substring (including braces) or null when the input has no
// balanced `{` ... `}` pair. Only used to be robust against trivial
// model preamble like "Here is the JSON: {...}". Does NOT accept
// trailing text as valid JSON — the parser decides that.
function extractJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
