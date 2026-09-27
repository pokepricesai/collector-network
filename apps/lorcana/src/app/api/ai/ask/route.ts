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
// Env required for the AI feature to actually answer (all optional
// until Luke wires them up):
//   NEXT_PUBLIC_AI_ENABLED   client-side flag; set to 'true' to
//                            render the UI.
//   AI_GATEWAY_URL           provider endpoint (Vercel AI Gateway
//                            or an OpenAI-compatible URL).
//   AI_GATEWAY_API_KEY       provider bearer token.
//   AI_GATEWAY_MODEL         model name, e.g. 'anthropic/claude-sonnet-4-6'
//                            or 'openai/gpt-4o-mini'. Defaults to
//                            'openai/gpt-4o-mini'.

import { NextRequest, NextResponse } from 'next/server';
import { LORCANA_SYSTEM_PROMPT } from '@/lib/ai-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AI_URL = process.env['AI_GATEWAY_URL'] ?? '';
const AI_KEY = process.env['AI_GATEWAY_API_KEY'] ?? '';
const AI_MODEL = process.env['AI_GATEWAY_MODEL'] ?? 'openai/gpt-4o-mini';

export async function POST(req: NextRequest) {
  if (!AI_URL || !AI_KEY) {
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
    const res = await fetch(AI_URL, {
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
