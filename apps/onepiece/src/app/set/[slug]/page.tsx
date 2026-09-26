import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSetBundle } from '@/server/browse';
import { canonicalFor } from '@/lib/seo';
import { buildPrintingSlug } from '@/lib/onepiece/slug';
import { normaliseRarity } from '@/lib/onepiece/rarity';
import { toOpGamedata } from '@/lib/onepiece/gamedata';
import { pickCardImage } from '@/lib/onepiece/image';
import { OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import type { TcgCard } from '@collector-network/database';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getSetBundle(slug);
  if (!bundle) {
    return { title: 'Set not found' };
  }
  const setLabel = bundle.set.name;
  return {
    title: `${setLabel} — every card and treatment`,
    description: `Complete One Piece ${setLabel} set (${bundle.set.code.toUpperCase()}). Every card, treatment and market price in one collector-grade catalogue.`,
    alternates: {
      canonical: canonicalFor(`/set/${encodeURIComponent(bundle.set.code.toLowerCase())}`),
    },
  };
}

export default async function SetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const bundle = await getSetBundle(slug);
  if (!bundle) notFound();

  const { set, cards } = bundle;

  // Group logical cards by name so parallels / secret / treasure / SP
  // CARD variants sit together (matches how a collector actually thinks
  // about the set, not how the shared schema stores rows).
  const byName = new Map<string, TcgCard[]>();
  for (const c of cards) {
    const bucket = byName.get(c.name);
    if (bucket) bucket.push(c);
    else byName.set(c.name, [c]);
  }
  const uniqueNames = [...byName.keys()].sort((a, b) => a.localeCompare(b));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${set.name} — One Piece Card Game`,
    url: canonicalFor(`/set/${encodeURIComponent(set.code.toLowerCase())}`),
    hasPart: uniqueNames.slice(0, 100).map((name) => ({
      '@type': 'CreativeWork',
      name,
    })),
  } as const;

  return (
    <div style={{ padding: '32px 24px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <Breadcrumbs setCode={set.code.toUpperCase()} setName={set.name} />

        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              {set.code.toUpperCase()} · Set
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 'clamp(24px, 4.5vw, 30px)' }}>{set.name}</h1>
            <p
              style={{
                margin: 0,
                color: 'var(--text-muted)',
                fontSize: 15,
                lineHeight: 1.6,
              }}
            >
              {uniqueNames.length} unique card{uniqueNames.length === 1 ? '' : 's'}
              {cards.length !== uniqueNames.length && (
                <>
                  {' · '}
                  {cards.length} priced printings
                </>
              )}
              {set.released_at && (
                <>
                  {' · '}Released {formatReleased(set.released_at)}
                </>
              )}
            </p>
          </div>
        </header>

        {cards.length === 0 ? (
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
            This set has no cards ingested yet.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
              gap: 14,
            }}
          >
            {uniqueNames.map((name) => {
              const family = byName.get(name)!;
              // Pick the "hero" row: prefer highest-rarity variant for
              // the tile art. Rarity codes are unordered in the raw
              // strings, so we sort by a small ordering key.
              const hero = pickHeroCard(family);
              const rarity = normaliseRarity(hero.rarity);
              const gd = toOpGamedata(hero.gamedata);
              const image = pickCardImage(hero.images, 'normal');
              const treatmentCount = family.length;
              const slug = buildPrintingSlug(
                hero.collector_number,
                hero.name,
              );
              return (
                <Link
                  key={name}
                  href={`/set/${encodeURIComponent(set.code.toLowerCase())}/card/${encodeURIComponent(slug)}`}
                  className="card-hover card-hover-gold"
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
                      position: 'relative',
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
                        alt={name}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    ) : (
                      <div className="op-card-empty" aria-hidden>
                        <span>Art loading</span>
                      </div>
                    )}
                  </div>
                  <div
                    className="op-colour-rail"
                    aria-hidden
                    style={{ marginTop: 2 }}
                  >
                    {(['red','green','blue','purple','black','yellow'] as const).map((hue) => (
                      <span
                        key={hue}
                        data-hue={hue}
                        data-present={gd.colours.includes(hue) ? 'true' : 'false'}
                      />
                    ))}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>
                    {name}
                  </div>
                  <div
                    className="label-mono"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {hero.collector_number ?? '—'} · {rarity.label}
                  </div>
                  {treatmentCount > 1 && (
                    <span
                      className="chip chip-gold"
                      style={{ width: 'fit-content' }}
                      title="Multiple treatments — parallel, secret rare, special card, treasure rare, promo or reprint"
                    >
                      +{treatmentCount - 1} treatments
                    </span>
                  )}
                  {gd.colours.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        flexWrap: 'wrap',
                      }}
                    >
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

function pickHeroCard(family: TcgCard[]): TcgCard {
  const order: Record<string, number> = {
    SEC: 6, secret: 6, 'secret rare': 6,
    SR: 5, 'super rare': 5,
    L: 4, leader: 4,
    R: 3, rare: 3,
    UC: 2, uncommon: 2,
    C: 1, common: 1,
  };
  const sorted = [...family].sort((a, b) => {
    const av = order[(a.rarity ?? '').toLowerCase()] ?? 0;
    const bv = order[(b.rarity ?? '').toLowerCase()] ?? 0;
    if (av !== bv) return bv - av;
    return (a.collector_number ?? '').localeCompare(b.collector_number ?? '');
  });
  return sorted[0]!;
}

function formatReleased(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function Breadcrumbs({
  setCode,
  setName,
}: {
  setCode: string;
  setName: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        marginBottom: 16,
        fontSize: 13,
        color: 'var(--text-muted)',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <Link
        href="/"
        style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
      >
        Home
      </Link>
      <span aria-hidden>›</span>
      <Link
        href="/browse"
        style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
      >
        Sets
      </Link>
      <span aria-hidden>›</span>
      <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
        {setCode} — {setName}
      </span>
    </nav>
  );
}
