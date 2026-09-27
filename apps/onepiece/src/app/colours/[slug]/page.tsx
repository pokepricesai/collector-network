import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isOpColour, OP_COLOUR_LABEL, type OpColour } from '@/lib/onepiece/colour';
import { canonicalFor } from '@/lib/seo';
import { queryFinder, type OpSort } from '@/server/finder';
import { listSetsWithCounts } from '@/server/browse';
import Faq from '@/components/Faq';
import { colourFaq } from '@/lib/faq-content';

// Real colour landing. Queries every card whose gamedata->colors
// array contains the requested colour (case-preserved from the JSON
// blob so dual-colour cards appear here for BOTH of their colours).

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isOpColour(slug)) return { title: 'Colour not found' };
  const label = OP_COLOUR_LABEL[slug];
  return {
    title: `${label} One Piece cards — Leaders, chase cards and live prices`,
    description: `Every ${label} One Piece Card Game card from every set, ranked by live retail price. Includes ${label} Leaders and multi-colour cards containing ${label}.`,
    alternates: { canonical: canonicalFor(`/colours/${slug}`) },
  };
}

const SUPPORTED_SORTS = new Set<OpSort>(['price-desc', 'price-asc', 'name', 'power-desc', 'set-newest', 'cost-asc']);

export default async function ColourDetail({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; cardType?: string }>;
}) {
  const { slug } = await params;
  if (!isOpColour(slug)) notFound();
  const label = OP_COLOUR_LABEL[slug];

  const sp = await searchParams;
  const rawSort = sp.sort ?? 'price-desc';
  const sort: OpSort = SUPPORTED_SORTS.has(rawSort as OpSort) ? (rawSort as OpSort) : 'price-desc';
  const cardType = sp.cardType && ['leader', 'character', 'event', 'stage', 'don'].includes(sp.cardType.toLowerCase())
    ? (sp.cardType.toLowerCase() as any)
    : undefined;

  const sets = await listSetsWithCounts();

  // Full colour grid + a leader-only slice for the spotlight rail.
  const [full, leaders] = await Promise.all([
    queryFinder(
      { colour: slug as OpColour, ...(cardType ? { cardType } : {}) },
      sort,
      0,
      120,
      sets.map((s) => s.set),
    ),
    queryFinder(
      { colour: slug as OpColour, cardType: 'leader' },
      'price-desc',
      0,
      6,
      sets.map((s) => s.set),
    ),
  ]);

  return (
    <div style={{ padding: '32px 24px 64px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <nav aria-label="Breadcrumb" style={breadcrumbStyle}>
          <Link href="/" style={crumbLinkStyle}>Home</Link>
          <span aria-hidden>›</span>
          <Link href="/colours" style={crumbLinkStyle}>Colours</Link>
          <span aria-hidden>›</span>
          <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{label}</span>
        </nav>

        <header className="op-page-hero" style={{ marginBottom: 20, position: 'relative' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <span className={`chip chip-${slug}`}>{label}</span>
            <h1 style={{ margin: '10px 0 6px', fontSize: 30 }}>{label} cards</h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, maxWidth: 640 }}>
              Every {label.toLowerCase()} card from every set, ranked by
              live retail price. Multi-colour Leaders that include{' '}
              {label.toLowerCase()} appear here too.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
              <Link href={`/card-finder?colour=${slug}`} className="btn btn-sm btn-primary" style={{ textDecoration: 'none' }}>
                Open in Card Finder
              </Link>
              <Link href={`/leaders?colour=${slug}`} className="btn btn-sm" style={{ textDecoration: 'none', padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border-strong, var(--border))', fontWeight: 700, fontSize: 13 }}>
                All {label} Leaders
              </Link>
            </div>
          </div>
        </header>

        {leaders.tiles.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <header style={{ marginBottom: 10 }}>
              <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Spotlight</div>
              <h2 style={{ margin: '4px 0 0', fontSize: 20 }}>Top-value {label} Leaders</h2>
            </header>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
            }}>
              {leaders.tiles.map((tile) => (
                <Link key={tile.cardId} href={tile.href} style={leaderTileStyle}>
                  <div style={imageWrapStyle}>
                    {tile.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={tile.imageUrl} alt={tile.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : <div style={imagePlaceholderStyle}>Art loading</div>}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{tile.name}</div>
                  <div className="label-mono" style={{ fontSize: 10 }}>
                    {(tile.set?.code ?? '').toUpperCase()} · {tile.collectorNumber}
                  </div>
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13, marginTop: 4 }}>
                    {tile.priceEur != null ? `€${tile.priceEur.toFixed(2)}` : 'Unpriced'}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <span className="label-mono">Type:</span>
          <TypeLink slug={slug} me={undefined} current={cardType} sort={sort}>All</TypeLink>
          <TypeLink slug={slug} me="leader" current={cardType} sort={sort}>Leaders</TypeLink>
          <TypeLink slug={slug} me="character" current={cardType} sort={sort}>Characters</TypeLink>
          <TypeLink slug={slug} me="event" current={cardType} sort={sort}>Events</TypeLink>
          <TypeLink slug={slug} me="stage" current={cardType} sort={sort}>Stages</TypeLink>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span className="label-mono">Sort:</span>
            <SortLink slug={slug} me="price-desc" current={sort} cardType={cardType}>Price ↓</SortLink>
            <SortLink slug={slug} me="power-desc" current={sort} cardType={cardType}>Power ↓</SortLink>
            <SortLink slug={slug} me="cost-asc"   current={sort} cardType={cardType}>Cost ↑</SortLink>
            <SortLink slug={slug} me="name"       current={sort} cardType={cardType}>A–Z</SortLink>
          </span>
        </div>

        <section style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))',
          gap: 14,
        }}>
          {full.tiles.map((tile) => (
            <article key={tile.cardId} style={tileStyle}>
              <Link href={tile.href} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gap: 8 }}>
                <div style={imageWrapStyle}>
                  {tile.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={tile.imageUrl} alt={tile.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : <div style={imagePlaceholderStyle}>Art loading</div>}
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{tile.name}</div>
                  <div className="label-mono" style={{ fontSize: 10.5 }}>
                    {(tile.set?.code ?? '').toUpperCase() || '—'} · {tile.collectorNumber ?? '—'} · {tile.rarity ?? '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                    {tile.gamedata.colours.map((c) => (
                      <span key={c} className={`chip chip-${c}`} style={{ fontSize: 9.5, padding: '2px 5px' }}>
                        {OP_COLOUR_LABEL[c]}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 }}>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13 }}>
                      {tile.priceEur != null ? `€${tile.priceEur.toFixed(2)}` : 'Unpriced'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {tile.printingCount}p
                    </div>
                  </div>
                </div>
              </Link>
            </article>
          ))}
        </section>

        <Faq title={`About ${label} One Piece cards`} entries={colourFaq(label, slug)} />
      </div>
    </div>
  );
}

function TypeLink({ slug, me, current, sort, children }: {
  slug: string;
  me?: string;
  current?: string;
  sort: string;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams();
  if (me) params.set('cardType', me);
  if (sort !== 'price-desc') params.set('sort', sort);
  const href = `/colours/${slug}${params.toString() ? `?${params.toString()}` : ''}`;
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
    }}>{children}</Link>
  );
}

function SortLink({ slug, me, current, cardType, children }: {
  slug: string;
  me: string;
  current: string;
  cardType?: string;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams();
  if (cardType) params.set('cardType', cardType);
  if (me !== 'price-desc') params.set('sort', me);
  const href = `/colours/${slug}${params.toString() ? `?${params.toString()}` : ''}`;
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
    }}>{children}</Link>
  );
}

const breadcrumbStyle: React.CSSProperties = {
  marginBottom: 16,
  fontSize: 13,
  color: 'var(--text-muted)',
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

const crumbLinkStyle: React.CSSProperties = { color: 'var(--text-muted)', textDecoration: 'none' };

const tileStyle: React.CSSProperties = {
  padding: 10,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
};

const leaderTileStyle: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: 10,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  textDecoration: 'none',
  color: 'var(--text)',
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
