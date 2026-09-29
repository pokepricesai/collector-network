import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { OP_COLOURS, OP_COLOUR_LABEL, type OpColour, isOpColour } from '@/lib/onepiece/colour';
import { queryFinder } from '@/server/finder';
import { listSetsWithCounts } from '@/server/browse';
import Faq from '@/components/Faq';
import { LEADERS_FAQ } from '@/lib/faq-content';

// Real Leaders directory. Every Leader card is fetched via the same
// finder query used by /card-finder — no separate ingest dependency.
// Verified 2026-09-27 against 364 Leader rows in production
// (78 distinct Leader names once deduped by name).

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'One Piece Leaders. Every Leader card, sorted by colour, set and price',
  description:
    'Directory of every One Piece Card Game Leader. Sort by colour, life, power and current market price.',
  alternates: { canonical: canonicalFor('/leaders') },
};

const SUPPORTED_SORTS = new Set(['price-desc', 'price-asc', 'name', 'power-desc', 'set-newest']);

export default async function LeadersPage({
  searchParams,
}: {
  searchParams: Promise<{ colour?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const colour = sp.colour && isOpColour(sp.colour.toLowerCase())
    ? (sp.colour.toLowerCase() as OpColour)
    : undefined;
  const sortRaw = sp.sort ?? 'price-desc';
  const sort = SUPPORTED_SORTS.has(sortRaw) ? sortRaw : 'price-desc';

  const sets = await listSetsWithCounts();
  const result = await queryFinder(
    { cardType: 'leader', ...(colour ? { colour } : {}) },
    sort as any,
    0,
    120,
    sets.map((s) => s.set),
  );

  return (
    <div style={{ padding: '32px 24px 64px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 20 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Leaders</div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Every Leader card
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
              Leaders anchor deck construction. Each entry shows life, power,
              colours and the current dearest live retail price across every
              treatment of the card. Click any leader for its printings.
            </p>
          </div>
        </header>

        <div style={{ marginBottom: 18, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="label-mono">Colour:</span>
          <Link href="/leaders" className={`chip${colour == null ? ' active' : ''}`} style={colourChipStyle(colour == null)}>
            Any
          </Link>
          {OP_COLOURS.map((c) => (
            <Link
              key={c}
              href={`/leaders?colour=${c}${sortRaw !== 'price-desc' ? `&sort=${sortRaw}` : ''}`}
              className={`chip chip-${c}${colour === c ? ' active' : ''}`}
              style={colourChipStyle(colour === c)}
            >
              {OP_COLOUR_LABEL[c]}
            </Link>
          ))}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span className="label-mono">Sort:</span>
            <SortLink current={sort} me="price-desc" colour={colour} label="Price ↓" />
            <SortLink current={sort} me="power-desc" colour={colour} label="Power ↓" />
            <SortLink current={sort} me="name"       colour={colour} label="A–Z" />
            <SortLink current={sort} me="set-newest" colour={colour} label="Set newest" />
          </span>
        </div>

        {result.tiles.length === 0 ? (
          <div style={emptyPanel}>No Leader cards match this colour.</div>
        ) : (
          <section style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
            gap: 14,
          }}>
            {result.tiles.map((tile) => (
              <article key={tile.cardId} style={leaderTileStyle}>
                <Link href={tile.href} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gap: 8 }}>
                  <div style={imageWrapStyle}>
                    {tile.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={tile.imageUrl}
                        alt={tile.name}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={imagePlaceholderStyle}>Art loading</div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{tile.name}</div>
                    <div className="label-mono" style={{ fontSize: 10.5 }}>
                      {(tile.set?.code ?? '').toUpperCase() || '–'} · {tile.collectorNumber ?? '–'}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      {tile.gamedata.colours.map((c) => (
                        <span key={c} className={`chip chip-${c}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                          {OP_COLOUR_LABEL[c]}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 12, color: 'var(--text)' }}>
                      {tile.gamedata.life != null && (
                        <span><strong>Life</strong> {tile.gamedata.life}</span>
                      )}
                      {tile.gamedata.power != null && (
                        <span><strong>Power</strong> {tile.gamedata.power.toLocaleString()}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 15 }}>
                        {tile.priceEur != null ? `€${tile.priceEur.toFixed(2)}` : 'Unpriced'}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                        {tile.printingCount} treatment{tile.printingCount === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                </Link>
              </article>
            ))}
          </section>
        )}

        <Faq title="About One Piece Leaders" entries={LEADERS_FAQ} />
      </div>
    </div>
  );
}

function SortLink({ current, me, colour, label }: {
  current: string;
  me: string;
  colour?: string;
  label: string;
}) {
  const params = new URLSearchParams();
  if (colour) params.set('colour', colour);
  if (me !== 'price-desc') params.set('sort', me);
  const href = `/leaders${params.toString() ? `?${params.toString()}` : ''}`;
  const active = current === me;
  return (
    <Link href={href} style={{
      padding: '5px 10px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      textDecoration: 'none',
      background: active ? 'var(--gold-600)' : 'transparent',
      color: active ? '#111' : 'var(--text-muted)',
      border: `1px solid ${active ? 'var(--gold-600)' : 'var(--border)'}`,
    }}>{label}</Link>
  );
}

function colourChipStyle(active: boolean): React.CSSProperties {
  return {
    textDecoration: 'none',
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 999,
    opacity: active ? 1 : 0.7,
    outline: active ? '2px solid var(--gold-600)' : 'none',
  };
}

const emptyPanel: React.CSSProperties = {
  marginTop: 24,
  padding: 24,
  background: 'var(--surface)',
  border: '1px dashed var(--border-strong)',
  borderRadius: 14,
  color: 'var(--text-muted)',
  textAlign: 'center',
  fontSize: 14,
};

const leaderTileStyle: React.CSSProperties = {
  padding: 12,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
};

const imageWrapStyle: React.CSSProperties = {
  position: 'relative',
  aspectRatio: '5 / 7',
  background: 'var(--bg-light)',
  borderRadius: 8,
  overflow: 'hidden',
};

const imagePlaceholderStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-muted)',
  fontSize: 12,
};
