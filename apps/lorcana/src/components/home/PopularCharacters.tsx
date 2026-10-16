import Link from 'next/link';
import type { CharacterListEntry } from '@/server/characters';

// Homepage character grid. Shows the 12 most-represented characters in
// the Lorcana catalogue — the recognisable collector entry points
// (Elsa, Mickey, Stitch, …) that the pre-CN-05C homepage had no path
// to beyond the top-nav /characters link. Each tile links to the
// character detail page where every printing of that character lives.
//
// Data: listCharacters() output already sorted by cardCount DESC, so
// slice(0, 12) is "most-represented". Rendered as a responsive grid
// that collapses to 2-wide on narrow viewports.

interface Props {
  characters: CharacterListEntry[];
}

export default function PopularCharacters({ characters }: Props) {
  if (characters.length === 0) return null;
  return (
    <section className="lc-section">
      <div className="lc-container">
        <header style={{
          marginBottom: 18,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}>
          <div>
            <div className="label-mono">Characters</div>
            <h2 style={{ margin: '4px 0 0' }}>Popular Lorcana characters</h2>
          </div>
          <Link href="/characters" className="btn btn-ghost btn-sm">
            All characters →
          </Link>
        </header>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 48%), 1fr))',
          gap: 12,
        }}>
          {characters.map((c) => (
            <Link
              key={c.slug}
              href={`/character/${encodeURIComponent(c.slug)}`}
              className="lc-hover lc-hover-gold"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              {c.representativeImage ? (
                <div style={{
                  position: 'relative',
                  aspectRatio: '5 / 7',
                  width: '100%',
                  overflow: 'hidden',
                  borderRadius: 8,
                  background: 'var(--bg-light)',
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.representativeImage}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                </div>
              ) : (
                <div style={{
                  aspectRatio: '5 / 7',
                  width: '100%',
                  background: 'var(--bg-light)',
                  borderRadius: 8,
                }} />
              )}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
              }}>
                <span style={{
                  fontWeight: 700,
                  fontSize: 14,
                  lineHeight: 1.25,
                  color: 'var(--text-strong)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {c.name}
                </span>
                <span style={{
                  fontSize: 11.5,
                  color: 'var(--text-muted)',
                  fontFamily: 'ui-monospace, monospace',
                }}>
                  {c.cardCount} card{c.cardCount === 1 ? '' : 's'}
                  {c.ink ? ` · ${c.ink}` : ''}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
