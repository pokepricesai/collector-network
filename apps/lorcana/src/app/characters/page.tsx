import type { Metadata } from 'next';
import Link from 'next/link';
import { listCharacters } from '../../server/characters';
import { canonicalFor } from '../../lib/seo';

// /characters — Lorcana character directory. Groups every
// tcg_cards row with cardType='CHARACTER' by base name (strip
// " - <subtitle>"). Each entry links to the exact character page.

export const revalidate = 21_600;

export const metadata: Metadata = {
  title: 'Lorcana characters directory',
  description:
    'Every Disney Lorcana character represented in the catalogue — Elsa, Mickey Mouse, Belle, Maleficent and beyond. Each character page collects every version and printing with live pricing.',
  alternates: { canonical: canonicalFor('/characters') },
};

export default async function CharactersIndexPage() {
  const characters = await listCharacters();
  const total = characters.length;
  const totalCards = characters.reduce((n, c) => n + c.cardCount, 0);

  return (
    <div className="lc-container lc-section">
      <header style={{ marginBottom: 24 }}>
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
          {totalCards.toLocaleString('en-US')} character-cards. Sorted by
          how many versions of each character exist in the catalogue.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {characters.map((c) => (
          <Link
            key={c.slug}
            href={`/character/${c.slug}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: 14,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              textDecoration: 'none',
              transition: 'transform 120ms, box-shadow 120ms',
            }}
          >
            {c.representativeImage && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={c.representativeImage}
                alt=""
                loading="lazy"
                style={{
                  width: '100%',
                  aspectRatio: '5 / 7',
                  objectFit: 'cover',
                  borderRadius: 8,
                  marginBottom: 10,
                  background: 'var(--bg-strong)',
                }}
              />
            )}
            <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
              {c.cardCount} {c.cardCount === 1 ? 'card' : 'cards'}
              {c.ink ? ` · ${c.ink}` : ''}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
