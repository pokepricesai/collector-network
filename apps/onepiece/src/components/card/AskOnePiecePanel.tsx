'use client';

// Ask OnePiecePrices — small AI panel on card pages. Feature-flagged
// by NEXT_PUBLIC_AI_ENABLED. Answers are grounded in a
// server-resolved context blob passed as a prop (name, set, rarity,
// treatments, colours, stats, live prices).

import { useState, useTransition } from 'react';

export interface AskOnePiecePanelProps {
  cardId: string;
  cardName: string;
  contextSummary: string;
  suggestions: string[];
}

const FLAG = process.env['NEXT_PUBLIC_AI_ENABLED'];

export default function AskOnePiecePanel(props: AskOnePiecePanelProps) {
  if (FLAG !== 'true') return null;
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
    <section
      style={{
        marginTop: 32,
        padding: 18,
        borderRadius: 14,
        border: '1px solid var(--border)',
        background:
          'linear-gradient(180deg, rgba(220,38,38,0.05) 0%, rgba(220,38,38,0) 60%), var(--surface)',
      }}
    >
      <div className="label-mono" style={{ marginBottom: 6, color: 'var(--gold-600)' }}>
        Ask OnePiecePrices
      </div>
      <h2 style={{ margin: '4px 0 6px', fontSize: 20, letterSpacing: '-0.01em' }}>
        Grounded answers about {props.cardName}
      </h2>
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.55 }}>
        Answers use this card&apos;s live database facts. Price,
        printings, rarity, colours, stats. OnePiecePrices AI does not
        invent card details.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {props.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setQuestion(s); ask(s); }}
            disabled={pending}
            className="chip chip-btn"
            style={{ fontSize: 12 }}
          >
            {s}
          </button>
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
          className="op-input"
          style={{
            flex: '1 1 260px',
            minWidth: 220,
            padding: '9px 12px',
            fontSize: 14,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg-light)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          style={{
            padding: '9px 16px',
            borderRadius: 10,
            background: 'var(--gold-600)',
            color: '#111',
            border: '1px solid var(--gold-600)',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.02em',
            cursor: pending ? 'not-allowed' : 'pointer',
          }}
        >
          {pending ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(193,56,73,0.08)', color: '#C13849', fontSize: 13 }}>
          {error}
        </div>
      )}
      {answer && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--bg-light)', border: '1px solid var(--border)', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {answer}
        </div>
      )}
    </section>
  );
}
