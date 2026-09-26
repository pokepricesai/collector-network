import type { Metadata } from 'next';
import Link from 'next/link';
import { searchCards } from '@/server/search';
import { canonicalFor } from '@/lib/seo';
import { slugifyCardName } from '@/lib/onepiece/slug';
import { normaliseRarity } from '@/lib/onepiece/rarity';
import { toOpGamedata } from '@/lib/onepiece/gamedata';
import { OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import { pickCardImage } from '@/lib/onepiece/image';

// Search is a PARAM_VARIANT route — canonical to self, noindex.
// See src/lib/seo.ts.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search One Piece cards',
  description:
    'Search every One Piece Card Game card by name across every set and treatment.',
  alternates: { canonical: canonicalFor('/cards/search') },
  robots: { index: false, follow: true },
};

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const results = query.length >= 2 ? await searchCards(query, 60) : [];

  // De-duplicate by name so alt-art / parallel treatments collapse in the
  // list. Each result links to the logical card page where all
  // treatments are shown.
  const byName = new Map<string, (typeof results)[number]>();
  for (const r of results) {
    if (!byName.has(r.name)) byName.set(r.name, r);
  }
  const uniques = [...byName.values()];

  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Cards
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              {query ? `Results for "${query}"` : 'Search One Piece cards'}
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15 }}>
              {query.length < 2
                ? 'Type at least two characters to search.'
                : `${uniques.length} unique name${uniques.length === 1 ? '' : 's'} matched.`}
            </p>
            <form
              method="get"
              action="/cards/search"
              style={{ marginTop: 14, maxWidth: 480, display: 'flex', gap: 8 }}
            >
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Name, e.g. Monkey D. Luffy"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-light)',
                  color: 'var(--text)',
                  fontSize: 15,
                  outline: 'none',
                }}
              />
              <button className="btn btn-primary btn-sm" type="submit">
                Search
              </button>
            </form>
          </div>
        </header>

        {query.length < 2 ? null : uniques.length === 0 ? (
          <div
            style={{
              padding: '32px 24px',
              background: 'var(--surface)',
              border: '1px dashed var(--border-strong)',
              borderRadius: 16,
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            No cards matched — try a shorter query or check spelling.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
              gap: 14,
            }}
          >
            {uniques.map((card) => {
              const rarity = normaliseRarity(card.rarity);
              const gd = toOpGamedata(card.gamedata);
              const image = pickCardImage(card.images, 'small');
              return (
                <Link
                  key={card.id}
                  href={`/card/${encodeURIComponent(slugifyCardName(card.name))}`}
                  className="card-hover"
                  style={{
                    display: 'grid',
                    gap: 8,
                    padding: 12,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    textDecoration: 'none',
                    color: 'var(--text)',
                  }}
                >
                  <div
                    style={{
                      aspectRatio: '5 / 7',
                      background:
                        'linear-gradient(180deg, var(--bg-light) 0%, var(--bg-strong) 100%)',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                  >
                    {image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={image}
                        alt={card.name}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    ) : null}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>
                    {card.name}
                  </div>
                  <div className="label-mono">
                    {(card.collector_number ?? '—')} · {rarity.label}
                  </div>
                  {gd.colours.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {gd.colours.map((c) => (
                        <span
                          key={c}
                          className={`chip chip-${c}`}
                          style={{ fontSize: 10 }}
                        >
                          {OP_COLOUR_LABEL[c]}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
