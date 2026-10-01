import type { Metadata } from 'next';
import { listCharacters } from '../../server/characters';
import { canonicalFor } from '../../lib/seo';
import { getCurrentUser } from '@collector-network/auth';
import { getOwnedCardIdSetForCurrentUser } from '../../server/collection-state';
import CharactersGrid, {
  type CharacterTileData,
} from '../../components/characters/CharactersGrid';

// /characters — Lorcana character directory. Groups every
// tcg_cards row with cardType='CHARACTER' by base name (strip
// " - <subtitle>"). Each entry links to the exact character page.
//
// Signed-in users see per-character completion stats computed from a
// single ownership scan (one query, derived in memory) — no N+1 across
// the ~674 character groups.

export const revalidate = 21_600;

export const metadata: Metadata = {
  title: 'Lorcana characters directory',
  description:
    'Every Disney Lorcana character represented in the catalogue — Elsa, Mickey Mouse, Belle, Maleficent and beyond. Each character page collects every version and printing with live pricing.',
  alternates: { canonical: canonicalFor('/characters') },
};

export default async function CharactersIndexPage() {
  const [characters, user] = await Promise.all([
    listCharacters(),
    getCurrentUser(),
  ]);
  const owned = user ? await getOwnedCardIdSetForCurrentUser() : new Set<string>();

  const total = characters.length;
  const totalCards = characters.reduce((n, c) => n + c.cardCount, 0);

  const entries: CharacterTileData[] = characters.map((c) => {
    let ownedCount = 0;
    if (user && owned.size > 0) {
      for (const id of c.cardIds) if (owned.has(id)) ownedCount++;
    }
    return {
      slug: c.slug,
      name: c.name,
      cardCount: c.cardCount,
      ownedCount,
      ink: c.ink,
      representativeImage: c.representativeImage,
    };
  });

  return (
    <div className="lc-container lc-section">
      <header style={{ marginBottom: 16 }}>
        <p
          style={{
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--accent-2, #6A43BE)',
            marginBottom: 4,
          }}
        >
          Characters · Disney Lorcana
        </p>
        <h1 style={{ fontSize: 32, margin: 0 }}>Lorcana characters</h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: 720, marginTop: 8 }}>
          {total.toLocaleString('en-US')} distinct characters across{' '}
          {totalCards.toLocaleString('en-US')} character-cards.
          {!user && (
            <>
              {' '}
              <a href="/sign-in?returnTo=/characters" style={{ color: 'var(--primary)' }}>
                Sign in to track completion
              </a>
              .
            </>
          )}
        </p>
      </header>

      <CharactersGrid entries={entries} isSignedIn={Boolean(user)} />
    </div>
  );
}
