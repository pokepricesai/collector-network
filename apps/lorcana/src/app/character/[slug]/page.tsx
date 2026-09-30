import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCharacterBySlug } from '../../../server/characters';
import { canonicalFor } from '../../../lib/seo';
import { slugifyCardName } from '../../../lib/lorcana/slug';

// /character/[slug] — every printing of a specific Lorcana character.
// Character key = base card name with " - Subtitle" stripped
// (see server/characters.ts). Version subtitle is preserved on the
// individual card tiles so collectors can pick the exact edition
// they own or want.

export const revalidate = 3_600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCharacterBySlug(slug);
  if (!data) {
    return { title: 'Character not found', robots: { index: false, follow: true } };
  }
  const canonical = canonicalFor(`/character/${data.slug}`);
  return {
    title: `${data.name} — every Lorcana card, printing and price`,
    description: `Every Disney Lorcana card featuring ${data.name}. All versions, sets, rarities and inks with live retail and graded pricing. ${data.totalCards} card${data.totalCards === 1 ? '' : 's'} indexed.`,
    alternates: { canonical },
  };
}

export default async function CharacterPage({ params }: Props) {
  const { slug } = await params;
  const data = await getCharacterBySlug(slug);
  if (!data) notFound();

  return (
    <div className="lc-container lc-section">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 12 }}>
        <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
        <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>
        <Link href="/characters" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Characters</Link>
        <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>
        <span>{data.name}</span>
      </nav>

      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, margin: 0 }}>{data.name}</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
          {data.totalCards} Lorcana card{data.totalCards === 1 ? '' : 's'} featuring this character
          {data.inks.length > 0 ? ` · Inks: ${data.inks.join(', ')}` : ''}
        </p>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        {data.versions.map((v) => {
          const cardSlug = slugifyCardName(v.card.name);
          return (
            <Link
              key={v.card.id}
              href={`/card/${cardSlug}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: 14,
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              {v.image && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={v.image}
                  alt={v.card.name}
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
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {v.versionSubtitle ? v.versionSubtitle : v.card.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {v.set?.code?.toUpperCase() ?? ''} {v.card.collector_number ?? ''}
                {v.rarity ? ` · ${v.rarity}` : ''}
                {v.ink ? ` · ${v.ink}` : ''}
              </div>
            </Link>
          );
        })}
      </section>

      <section
        style={{
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--surface)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Related</h2>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
          <li><Link href="/characters">All Lorcana characters</Link></li>
          {data.inks.map((ink) => (
            <li key={ink}>
              <Link href={`/inks/${ink.toLowerCase()}`}>All {ink} cards</Link>
            </li>
          ))}
          <li><Link href="/card-finder">Card Finder</Link></li>
          <li><Link href="/browse">Every Lorcana set</Link></li>
        </ul>
      </section>
    </div>
  );
}
