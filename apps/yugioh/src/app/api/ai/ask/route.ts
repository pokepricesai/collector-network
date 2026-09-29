// apps/yugioh/src/app/api/ai/ask/route.ts
//
// Feature-flagged AI endpoint for Ask YGOPrices. Grounded entirely in
// the DB-derived context supplied by the client (name, frame, monster
// type, attribute, level/rank/link, ATK/DEF, archetype, rules text,
// set, rarity, printings, current prices, F&L status). No server-side
// card fetching — the card page has already resolved the context.
//
// Env required:
//   NEXT_PUBLIC_AI_ENABLED   client-side flag; 'true' renders the UI.
//   AI_GATEWAY_URL           Vercel AI Gateway base:
//                            https://ai-gateway.vercel.sh/v1
//   AI_GATEWAY_API_KEY       Gateway bearer token (SENSITIVE; never
//                            read, printed, copied or logged).
//   AI_GATEWAY_MODEL         Model string. Defaults to a cheap tier
//                            (anthropic/claude-haiku-4-5) matching
//                            the network provider strategy.

import { NextRequest, NextResponse } from 'next/server';
import { YGO_SYSTEM_PROMPT } from '@/lib/ai-knowledge';
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Narrow anti-abuse guard: 20 requests per minute per client IP.
// Genuine card-page usage sits far below this; scripted bursts hit
// 429 quickly. Best-effort — same instance is required for the count
// to accumulate, which is fine for the abuse pattern we care about.
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
          'Ask YGOPrices is not yet configured on this environment. ' +
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
          'Ask YGOPrices is receiving too many requests from your IP. ' +
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

  const systemPrompt = `${YGO_SYSTEM_PROMPT}\n\nCard facts for this question (ground truth):\n${context}\n\nRules:\n- Only cite facts provided above. Never invent prices, printings, editions, rarities, legality or rulings.\n- If the user asks whether a card is Forbidden / Limited / Semi-Limited and the facts do not include a banlist state, answer with uncertainty and point at /forbidden-limited.\n- If the user asks whether a card is worth buying or will go up in price, refuse to speculate and point at the price-history chart.\n- Absence of a printing / edition / rarity in the facts means we do not have data for it. Treat it as unknown, not as negative proof that it does not exist.\n- Keep answers to at most six sentences.`;

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
