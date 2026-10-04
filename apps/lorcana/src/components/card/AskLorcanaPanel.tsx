'use client';

// Ask LorcanaPrices — small AI panel on card pages.
//
// Feature-flagged by NEXT_PUBLIC_AI_ENABLED. When the flag is falsy
// the whole component renders `null` — no bundle-time regression.
// When enabled, it renders a lightweight "ask" surface with three
// suggested prompts and a free-text input. All user prompts POST to
// /api/ai/ask which supplies the grounded card context server-side.
//
// The card context (name, set, rarity, ink, stats, printings, prices)
// is passed in as a fully-resolved prop from the server card page —
// so the AI never has to fetch or invent facts.

import { useState, useTransition } from 'react';

export interface AskLorcanaPanelProps {
  cardId: string;
  cardName: string;
  contextSummary: string;
  suggestions: string[];
}

const FLAG = process.env['NEXT_PUBLIC_AI_ENABLED'];

export default function AskLorcanaPanel(props: AskLorcanaPanelProps) {
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
          body: JSON.stringify({ cardId: props.cardId, cardName: props.cardName, context: props.contextSummary, question: q }),
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
        background: 'linear-gradient(180deg, rgba(41,113,196,0.05) 0%, rgba(41,113,196,0) 60%), var(--surface)',
      }}
    >
      <div className="label-mono" style={{ marginBottom: 6, color: 'var(--ink-sapphire, #2971C4)' }}>
        Ask LorcanaPrices
      </div>
      <h2 style={{ margin: '4px 0 6px', fontSize: 20, letterSpacing: '-0.01em' }}>
        Get grounded answers about {props.cardName}
      </h2>
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.55 }}>
        Answers use this card&apos;s live database facts, price,
        printings, rarity, ink, stats. LorcanaPrices AI does not
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
          className="lc-input"
          style={{ flex: '1 1 260px', minWidth: 220, padding: '9px 12px', fontSize: 14 }}
          disabled={pending}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={pending || !question.trim()}
          style={{ padding: '9px 16px', fontWeight: 700, fontSize: 13 }}
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
