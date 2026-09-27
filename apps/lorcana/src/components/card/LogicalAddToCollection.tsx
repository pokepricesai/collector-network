'use client';

// LogicalAddToCollection — the "Add to collection" surface on a
// logical card page. A logical card has multiple printings (a
// treatment × finish matrix), so we cannot insert an ambiguous row.
// The flow is:
//
//   Signed OUT     → Sign in / Create account CTAs with returnTo.
//   Signed IN, closed → primary "Add to collection" button.
//   Signed IN, open   → grid of every real printing on this card; the
//                       user picks one; the existing AddToCollection
//                       form loads pre-scoped to that printing id.
//
// The picker never falls back to a "default" printing — the user
// always chooses the exact printing that maps to a real DB row.

import Link from 'next/link';
import { useState } from 'react';
import { AddToCollection } from '../AddToCollection';

export interface PrintingPick {
  cardId: string;
  printingId: string;
  treatmentLabel: string;
  treatmentCode: string;
  finish: string | null;
  setCode: string | null;
  collectorNumber: string | null;
}

export interface LogicalAddToCollectionProps {
  cardName: string;
  isSignedIn: boolean;
  returnPath: string;
  printings: PrintingPick[];
}

export default function LogicalAddToCollection(props: LogicalAddToCollectionProps) {
  const [picked, setPicked] = useState<PrintingPick | null>(null);
  const [open, setOpen] = useState(false);
  const returnParam = encodeURIComponent(props.returnPath);

  if (!props.isSignedIn) {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link
          href={`/sign-up?returnTo=${returnParam}`}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            background: 'var(--ink-amethyst, #6A43BE)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: 13.5,
            fontWeight: 800,
            letterSpacing: '0.02em',
          }}
        >
          Add to collection — create free account
        </Link>
        <Link
          href={`/sign-in?returnTo=${returnParam}`}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-strong, var(--border))',
            background: 'var(--surface)',
            color: 'var(--text-strong)',
            textDecoration: 'none',
            fontSize: 13.5,
            fontWeight: 700,
          }}
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '10px 18px',
          borderRadius: 10,
          background: 'var(--ink-amethyst, #6A43BE)',
          color: '#fff',
          border: '1px solid transparent',
          fontFamily: 'inherit',
          fontSize: 13.5,
          fontWeight: 800,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Add to collection
      </button>
    );
  }

  // Picker + form
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)' }}>
          {picked
            ? `Adding ${props.cardName} — ${picked.treatmentLabel}${picked.finish ? ` · ${picked.finish}` : ''}${picked.collectorNumber ? ` · #${picked.collectorNumber}` : ''}`
            : `Which printing of ${props.cardName} do you own?`}
        </div>
        <button
          type="button"
          onClick={() => { setPicked(null); setOpen(false); }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Cancel
        </button>
      </div>

      {!picked ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 8,
          }}
        >
          {props.printings.map((p) => (
            <button
              key={p.printingId}
              type="button"
              onClick={() => setPicked(p)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-light, var(--surface))',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span
                className={`treatment-badge treatment-badge--${p.treatmentCode.toLowerCase()}`}
                style={{ alignSelf: 'flex-start' }}
              >
                {p.treatmentLabel}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {p.finish ?? 'nonfoil'}
                {p.setCode ? ` · ${p.setCode.toUpperCase()}` : ''}
                {p.collectorNumber ? ` · #${p.collectorNumber}` : ''}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setPicked(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--primary)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                padding: 0,
              }}
            >
              ← Pick a different printing
            </button>
          </div>
          <AddToCollection
            cardId={picked.cardId}
            printingId={picked.printingId}
            cardName={props.cardName}
            isSignedIn={true}
          />
        </div>
      )}
    </div>
  );
}
