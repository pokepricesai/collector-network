// apps/lorcana/src/app/api/ai/ask/route.ts
//
// Feature-flagged AI endpoint for Ask LorcanaPrices. Grounded in the
// card context supplied by the client (name, set, rarity, ink, stats,
// printings, prices). No server-side card fetching — the client's
// context has already been resolved on the card page render.
//
// Provider integration is deliberately abstract. When AI_GATEWAY_URL
// and AI_GATEWAY_API_KEY are set, we forward through a Vercel AI
// Gateway (or any OpenAI-compatible proxy). When either is missing
// the endpoint returns a safe 503 with a plainly-worded message —
// nothing hallucinated, no fake answers.
//
// Env required for the AI feature to actually answer:
//   NEXT_PUBLIC_AI_ENABLED  client-side flag; 'true' renders the UI.
//   AI_GATEWAY_URL          Vercel AI Gateway base — expected value:
//                           https://ai-gateway.vercel.sh/v1
//   AI_GATEWAY_API_KEY      Gateway bearer token (SENSITIVE; never
//                           read, printed, copied or logged here).
//   AI_GATEWAY_MODEL        Gateway model string. Defaults to a cheap
//                           tier when unset (anthropic/claude-haiku-4-5)
//                           aligning with the network provider strategy.

import { NextRequest, NextResponse } from 'next/server';
import { LORCANA_SYSTEM_PROMPT } from '@/lib/ai-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AI_URL_BASE = (process.env['AI_GATEWAY_URL'] ?? '').replace(/\/+$/, '');
const AI_KEY = process.env['AI_GATEWAY_API_KEY'] ?? '';
const AI_MODEL = process.env['AI_GATEWAY_MODEL'] ?? 'anthropic/claude-haiku-4-5';

// Gateway path — resolves to `${base}/chat/completions` when the base
// is the Vercel AI Gateway root. Legacy callers may already have the
// full path in the env; we append only when the base doesn't end in
// `chat/completions`.
function resolveEndpoint(): string {
  if (!AI_URL_BASE) return '';
  if (/\/chat\/completions$/.test(AI_URL_BASE)) return AI_URL_BASE;
  return `${AI_URL_BASE}/chat/completions`;
}

export async function POST(req: NextRequest) {
  const endpoint = resolveEndpoint();
  if (!endpoint || !AI_KEY) {
    return NextResponse.json(
      {
        ok: false,
        answer:
          'Ask LorcanaPrices is not yet configured on this environment. ' +
          'The site owner needs to set AI_GATEWAY_URL and AI_GATEWAY_API_KEY.',
      },
      { status: 503 },
    );
  }
  let body: {
    cardId?: string;
    cardName?: string;
    context?: string;
    question?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, answer: 'Invalid request body.' }, { status: 400 });
  }
  const cardName = (body.cardName ?? '').trim();
  const context = (body.context ?? '').trim();
  const question = (body.question ?? '').trim();
  if (!cardName || !context || !question) {
    return NextResponse.json({ ok: false, answer: 'Missing card context or question.' }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ ok: false, answer: 'Question too long.' }, { status: 400 });
  }

  const systemPrompt = `${LORCANA_SYSTEM_PROMPT}\n\nCard facts for this question (ground truth):\n${context}\n\nRules:\n- Never invent card facts, prices, printings or rarity.\n- Cite the exact values above where relevant.\n- Refuse to predict future prices; direct the user to the price-history chart.\n- Keep responses under 6 sentences.`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        max_tokens: 400,
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ ok: false, answer: `AI provider error (${res.status}).`, providerBody: txt.slice(0, 300) }, { status: 502 });
    }
    const data = await res.json();
    // OpenAI-compatible response shape.
    const answer =
      data?.choices?.[0]?.message?.content ??
      data?.content ??
      'No answer returned by the AI provider.';
    return NextResponse.json({ ok: true, answer: String(answer).trim() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, answer: `AI request failed: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 502 },
    );
  }
}
