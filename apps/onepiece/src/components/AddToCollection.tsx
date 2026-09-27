'use client';

// Add-to-Collection control. Mounted on printing detail pages. When
// no user is signed in this renders a "Sign in to save" link; when
// signed in it exposes a compact form: raw/graded toggle, grader +
// grade (for graded), condition (for raw), quantity, and a submit
// button.
//
// The Add server action lives in /collection/actions.ts and enforces
// RLS via the caller's own session. The button intentionally does
// NOT reveal DB-level errors verbatim; a short user-facing message
// is enough.

import { useState, useTransition } from 'react';
import {
  CONDITION_LABELS,
  CONDITION_VALUES,
  GRADER_VALUES,
  type Condition,
  type Grader,
} from '../lib/collection-types';
import { addCollectionAction } from '../app/collection/actions';
import { analytics } from '../lib/analytics';

interface Props {
  cardId: string;
  printingId: string;
  cardName: string;
  isSignedIn: boolean;
}

export function AddToCollection({ cardId, printingId, cardName, isSignedIn }: Props) {
  const [open, setOpen] = useState(false);
  const [isGraded, setIsGraded] = useState(false);
  const [grader, setGrader] = useState<Grader | ''>('');
  const [grade, setGrade] = useState('');
  const [condition, setCondition] = useState<Condition>('near-mint');
  const [quantity, setQuantity] = useState(1);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) {
    return (
      <a
        href={`/sign-in?returnTo=${encodeURIComponent(typeof window === 'undefined' ? '/' : window.location.pathname)}`}
        style={{
          display: 'inline-block',
          padding: '9px 14px',
          borderRadius: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border-strong, var(--border))',
          color: 'var(--text)',
          textDecoration: 'none',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Sign in to save
      </a>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setMessage(null);
          setError(null);
        }}
        style={{
          padding: '9px 14px',
          borderRadius: 10,
          background: 'var(--gold-600)',
          color: '#111',
          border: '1px solid var(--gold-600)',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Add to collection
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setMessage(null);
        start(async () => {
          const r = await addCollectionAction({
            tcg_card_id: cardId,
            tcg_printing_id: printingId,
            quantity,
            is_graded: isGraded,
            grader: isGraded ? (grader as Grader) : null,
            grade: isGraded ? grade : null,
            condition: isGraded ? null : condition,
          });
          if (r.ok) {
            analytics.addToCollection({ section: 'printing-page' });
            setMessage(`Added ${quantity} × ${cardName} to your collection.`);
            setOpen(false);
          } else if (r.tableMissing) {
            setError('Collection storage is being provisioned — try again shortly.');
          } else {
            setError(r.error ?? 'Something went wrong. Try again.');
          }
        });
      }}
      style={{
        display: 'grid',
        gap: 10,
        padding: 14,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={isGraded}
          onChange={(e) => setIsGraded(e.target.checked)}
          style={{ accentColor: 'var(--gold-600)' }}
        />
        Graded slab
      </label>

      {isGraded ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={sublabelStyle}>Grader</span>
            <select
              value={grader}
              onChange={(e) => setGrader(e.target.value as Grader | '')}
              required
              style={inputStyle}
            >
              <option value="">Choose…</option>
              {GRADER_VALUES.map((g) => (
                <option key={g} value={g}>
                  {g.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={sublabelStyle}>Grade</span>
            <input
              type="text"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="10, 9.5, 9…"
              required
              maxLength={8}
              style={inputStyle}
            />
          </label>
        </div>
      ) : (
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={sublabelStyle}>Condition</span>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as Condition)}
            style={inputStyle}
          >
            {CONDITION_VALUES.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label style={{ display: 'grid', gap: 4 }}>
        <span style={sublabelStyle}>Quantity</span>
        <input
          type="number"
          min={1}
          max={999}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
          style={{ ...inputStyle, width: 100 }}
        />
      </label>

      {error && (
        <p style={{ margin: 0, padding: '6px 8px', borderRadius: 6, background: 'rgba(177,42,47,0.1)', border: '1px solid rgba(177,42,47,0.3)', color: '#8a1c1f', fontSize: 12 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: '9px 14px',
            borderRadius: 10,
            background: 'var(--gold-600)',
            color: '#111',
            border: '1px solid var(--gold-600)',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            cursor: pending ? 'not-allowed' : 'pointer',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          style={{
            padding: '9px 14px',
            borderRadius: 10,
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-strong, var(--border))',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            cursor: pending ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
      </div>

      {message && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--gold-600)' }}>{message}</p>
      )}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-strong, var(--border))',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
};

const sublabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};
