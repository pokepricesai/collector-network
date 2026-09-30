'use client';

// LogicalWatch — the "Watch" surface on a logical card page.
//
// Semantics parallel LogicalAddToCollection:
//   * Signed OUT             → Sign in / Create account CTAs.
//   * Signed IN, one printing → auto-selected. Renders a plain
//                              WatchButton for that exact printing id.
//   * Signed IN, multiple    → primary "Watch" button. On click,
//                              opens a picker of every real printing.
//                              Each row has its OWN Watch/Watching
//                              toggle, so a user can watch several
//                              treatments independently.
//
// The picker never defaults to a "first" printing when there are
// several — the user always chooses the exact tcg_printing_id.

import Link from 'next/link';
import { useState } from 'react';
import { WatchButton } from '../WatchButton';

export interface WatchablePrinting {
  cardId: string;
  printingId: string;
  treatmentLabel: string;
  treatmentCode: string;
  finish: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  initialWatching: boolean;
}

export interface LogicalWatchProps {
  cardName: string;
  isSignedIn: boolean;
  returnPath: string;
  printings: WatchablePrinting[];
}

export default function LogicalWatch(props: LogicalWatchProps) {
  const [open, setOpen] = useState(false);
  const returnParam = encodeURIComponent(props.returnPath);

  if (!props.isSignedIn) {
    return (
      <Link
        href={`/sign-in?returnTo=${returnParam}`}
        style={{
          padding: '10px 14px',
          borderRadius: 10,
          background: 'transparent',
          color: 'var(--text-strong)',
          textDecoration: 'none',
          fontSize: 13.5,
          fontWeight: 700,
          border: '1px solid var(--border-strong, var(--border))',
        }}
      >
        Watch
      </Link>
    );
  }

  //  Single-printing card: no chooser — bind the WatchButton directly
  //  to the one and only tcg_printing_id.
  if (props.printings.length === 1) {
    const p = props.printings[0]!;
    return (
      <WatchButton
        tcgCardId={p.cardId}
        tcgPrintingId={p.printingId}
        initialWatching={p.initialWatching}
        signedIn={true}
        currentPathname={props.returnPath}
      />
    );
  }

  //  Multi-printing: closed → primary "Watch" opener; open → grid of
  //  every printing with its own toggle.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '10px 18px',
          borderRadius: 10,
          background: 'transparent',
          color: 'var(--text-strong)',
          border: '1px solid var(--border-strong, var(--border))',
          fontFamily: 'inherit',
          fontSize: 13.5,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Watch
      </button>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface)',
        padding: 14,
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)' }}>
          Which printing of {props.cardName} do you want to watch?
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Close
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 8,
        }}
      >
        {props.printings.map((p) => (
          <div
            key={p.printingId}
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-light, var(--surface))',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minWidth: 0,
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
            <WatchButton
              tcgCardId={p.cardId}
              tcgPrintingId={p.printingId}
              initialWatching={p.initialWatching}
              signedIn={true}
              currentPathname={props.returnPath}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
