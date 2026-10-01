'use client';

// Per-tile Add-to-Collection control for /character/[slug].
//
// Scoped to a single tcg_cards row — exact collectible identity.
//   * Signed OUT   → Sign in CTA with returnTo back to this page.
//   * One printing → auto-select, direct AddToCollection form.
//   * Many prints  → inline finish picker; user chooses the exact
//                    printing before the AddToCollection form opens.
//
// Owned-state badging is rendered by the parent tile (it already
// loaded the per-user owned set in bulk). This control never pulls
// its own user state.

import Link from 'next/link';
import { useState } from 'react';
import { AddToCollection } from '../AddToCollection';

export interface CharacterTilePrinting {
  id: string;
  finish: string | null;
}

interface Props {
  cardId: string;
  cardName: string;
  isSignedIn: boolean;
  returnPath: string;
  printings: CharacterTilePrinting[];
  isOwned: boolean;
}

export default function CharacterTileAdd({
  cardId,
  cardName,
  isSignedIn,
  returnPath,
  printings,
  isOwned,
}: Props) {
  const [picked, setPicked] = useState<CharacterTilePrinting | null>(null);

  if (!isSignedIn) {
    return (
      <Link
        href={`/sign-in?returnTo=${encodeURIComponent(returnPath)}`}
        style={{
          display: 'inline-block',
          padding: '7px 11px',
          borderRadius: 8,
          border: '1px solid var(--border-strong, var(--border))',
          background: 'var(--surface)',
          color: 'var(--text)',
          textDecoration: 'none',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        Sign in to collect
      </Link>
    );
  }

  if (printings.length === 0) {
    return null;
  }

  if (printings.length === 1) {
    return (
      <AddToCollection
        cardId={cardId}
        printingId={printings[0]!.id}
        cardName={cardName}
        isSignedIn={true}
      />
    );
  }

  if (!picked) {
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          {isOwned ? 'Add another printing' : 'Pick a printing'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {printings.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPicked(p)}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-strong, var(--border))',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {p.finish ?? 'nonfoil'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button
        type="button"
        onClick={() => setPicked(null)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--primary)',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          padding: 0,
          textAlign: 'left',
        }}
      >
        ← Pick a different printing ({picked.finish ?? 'nonfoil'})
      </button>
      <AddToCollection
        cardId={cardId}
        printingId={picked.id}
        cardName={cardName}
        isSignedIn={true}
      />
    </div>
  );
}
