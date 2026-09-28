'use client';

// Ask YGOPrices — small AI panel rendered on card pages. Feature-
// flagged by NEXT_PUBLIC_AI_ENABLED. All context is server-resolved
// (name, frame, attribute, monster type, level/rank/link, ATK/DEF,
// archetype, rules text, set, rarity, printings, current prices,
// banlist status) and passed in as a prop.

import { useState, useTransition } from 'react';

export interface AskYGOPricesPanelProps {
  cardId: string;
  cardName: string;
  contextSummary: string;
  suggestions: string[];
}

const FLAG = process.env['NEXT_PUBLIC_AI_ENABLED'];

export default function AskYGOPricesPanel(props: AskYGOPricesPanelProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Feature flag check AFTER hooks so the hook order stays stable.
  if (FLAG !== 'true') return null;

  function ask(q: string) {
    if (!q.trim()) return;
    setAnswer(null);
    setError(null);
    start(async () => {
      try {
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cardId: props.cardId,
            cardName: props.cardName,
            context: props.contextSummary,
            question: q,
          }),
        });
        if (!res.ok) {
          setError(`AI request failed (${res.status})`);
          return;
        }
        const data = await res.json();
        setAnswer(data.answer ?? 'No answer.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'AI request failed');
      }
    });
  }

  return (
    <section style={{
      marginTop: 32,
      padding: 18,
      borderRadius: 14,
      border: '1px solid var(--ygo-border, #E5E7EB)',
      background: 'linear-gradient(180deg, rgba(124,58,237,0.05) 0%, rgba(124,58,237,0) 60%), var(--ygo-surface, #FFF)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--ygo-accent-gold-strong, #B78A0F)',
        marginBottom: 6,
      }}>Ask YGOPrices</div>
      <h2 style={{ margin: '4px 0 6px', fontSize: 20, letterSpacing: '-0.01em' }}>
        Grounded answers about {props.cardName}
      </h2>
      <p style={{ margin: '0 0 14px', color: 'var(--ygo-text-muted, #6B7280)', fontSize: 13, lineHeight: 1.55 }}>
        Answers cite this card&apos;s live database facts. Printings,
        rarity, edition, ATK/DEF, archetype, current prices and
        Forbidden &amp; Limited status where recorded. YGOPrices AI
        does not invent card details.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {props.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setQuestion(s); ask(s); }}
            disabled={pending}
            style={{
              padding: '6px 10px', borderRadius: 999,
              border: '1px solid var(--ygo-border, #E5E7EB)',
              background: 'var(--ygo-bg-light, #F9FAFB)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
              color: 'var(--ygo-text, #111827)',
              fontFamily: 'inherit',
            }}
          >{s}</button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(question); }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask about ${props.cardName}…`}
          style={{
            flex: '1 1 260px', minWidth: 220,
            padding: '9px 12px', fontSize: 14,
            borderRadius: 10,
            border: '1px solid var(--ygo-border, #E5E7EB)',
            background: 'var(--ygo-bg-light, #F9FAFB)',
            color: 'var(--ygo-text, #111827)',
            fontFamily: 'inherit', outline: 'none',
            boxSizing: 'border-box',
          }}
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          style={{
            padding: '9px 16px', borderRadius: 10,
            background: 'var(--ygo-accent-gold-strong, #B78A0F)',
            color: '#FFF',
            border: '1px solid var(--ygo-accent-gold-strong, #B78A0F)',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.02em',
            cursor: pending ? 'not-allowed' : 'pointer',
          }}
        >{pending ? 'Asking…' : 'Ask'}</button>
      </form>

      {error && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(193,56,73,0.08)', color: '#C13849', fontSize: 13 }}>
          {error}
        </div>
      )}
      {answer && (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 10,
          background: 'var(--ygo-bg-light, #F9FAFB)',
          border: '1px solid var(--ygo-border, #E5E7EB)',
          fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap',
        }}>{answer}</div>
      )}
    </section>
  );
}
