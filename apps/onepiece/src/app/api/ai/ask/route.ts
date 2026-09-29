// apps/onepiece/src/app/api/ai/ask/route.ts
//
// Feature-flagged AI endpoint for Ask OnePiecePrices. Grounded in the
// card context supplied by the client (name, set, rarity, treatments,
// colours, stats, printings, prices). No server-side card fetching —
// the client's context has already been resolved on the card page
// render.
//
// Env required:
//   NEXT_PUBLIC_AI_ENABLED   client-side flag; 'true' renders the UI.
//   AI_GATEWAY_URL           Vercel AI Gateway base URL, expected:
//                            https://ai-gateway.vercel.sh/v1
//   AI_GATEWAY_API_KEY       Gateway bearer token (SENSITIVE; never
//                            read, printed, copied or logged here).
//   AI_GATEWAY_MODEL         Gateway model string. Defaults to
//                            anthropic/claude-haiku-4-5.

import { NextRequest, NextResponse } from 'next/server';
import { ONEPIECE_SYSTEM_PROMPT } from '@/lib/ai-knowledge';
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Narrow anti-abuse guard: 20 requests per minute per client IP.
// Genuine card-page usage sits far below this ceiling; scripted
// bursts hit 429 quickly.
const AI_ASK_LIMIT = { windowMs: 60_000, max: 20 };

const AI_URL_BASE = (process.env['AI_GATEWAY_URL'] ?? '').replace(/\/+$/, '');
const AI_KEY = process.env['AI_GATEWAY_API_KEY'] ?? '';
const AI_MODEL = process.env['AI_GATEWAY_MODEL'] ?? 'anthropic/claude-haiku-4-5';

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
          'Ask OnePiecePrices is not yet configured on this environment. ' +
          'The site owner needs to set AI_GATEWAY_URL and AI_GATEWAY_API_KEY.',
      },
      { status: 503 },
    );
  }
  const ip = clientIpFrom(req.headers);
  const rl = checkRateLimit(`ai:ask:${ip}`, AI_ASK_LIMIT);
  if (!rl.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return NextResponse.json(
      {
        ok: false,
        answer:
          'Ask OnePiecePrices is receiving too many requests from your IP. ' +
          'Please slow down and try again in a moment.',
      },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
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

  const systemPrompt = `${ONEPIECE_SYSTEM_PROMPT}\n\nCard facts for this question (ground truth):\n${context}\n\nRules:\n- Never invent card facts, prices, treatments or rarity.\n- Cite the exact values above where relevant.\n- Refuse to predict future prices; direct the user to the price-history chart.\n- Keep responses under 6 sentences.`;

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
      return NextResponse.json(
        { ok: false, answer: `AI provider error (${res.status}).`, providerBody: txt.slice(0, 300) },
        { status: 502 },
      );
    }
    const data = await res.json();
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
