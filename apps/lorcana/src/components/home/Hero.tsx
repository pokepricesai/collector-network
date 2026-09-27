import HomeSearch from '@/components/HomeSearch';
import Link from 'next/link';
import type { DiscoveryTile } from '@/server/discovery';
import { pickCardImage } from '@/lib/lorcana/image';
import { slugifyCardName } from '@/lib/lorcana/slug';

// Homepage hero — rebuilt during the Lorcana-only launch blocker pass.
//
// Layout:
//   LEFT  — proposition, concise explanation, search, primary CTAs.
//           One coherent type system: Outfit for the headline, Figtree
//           for body, Cormorant Garamond italic only for a small
//           evergreen sub-line so the mark still feels storybook.
//   RIGHT — one useful value module. When the caller passes a
//           populated `mostValuable` we render the actual top-priced
//           card as a linked hero tile with real live pricing. When
//           empty (no priced data) we render a collection-CTA panel
//           so the right column is never decorative empty space.
//
// Deliberately NO frosted-glass / opaque background. The old ink-wheel
// crest + spark-field are dropped from the hero so the price
// information dominates the fold.

interface HeroProps {
  cardCount: number;
  setCount: number;
  enchantedCount: number;
  mostValuable?: DiscoveryTile[];
}

function fmt(n: number): string {
  if (n < 1_000) return String(n);
  return n.toLocaleString('en-US');
}

function money(usd: number, eur: number | null): string {
  if (eur != null) {
    return `€${eur.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  return `$${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export default function Hero({
  cardCount, setCount, enchantedCount, mostValuable = [],
}: HeroProps) {
  const topCard = mostValuable[0];
  return (
    <section className="lc-hero" style={{ paddingTop: 44, paddingBottom: 36 }}>
      <div
        className="lc-container"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)',
          gap: 40,
          alignItems: 'start',
        }}
      >
        {/* ── LEFT: proposition + search + CTAs ─────────────── */}
        <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
          <div>
            <h1 style={{ margin: 0, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
              Track every Lorcana card, printing and{' '}
              <span className="gold-text">Enchanted</span>.
            </h1>
            <p
              style={{
                margin: '14px 0 0',
                fontSize: 'var(--step-1)',
                color: 'var(--text-muted)',
                lineHeight: 1.55,
                maxWidth: 560,
              }}
            >
              Search the catalogue, compare prices across foil and nonfoil,
              track a collection and find the exact printing you want.
              {cardCount > 0 && (
                <>
                  {' '}
                  <span className="lc-serif-italic" style={{ color: 'var(--text-strong)' }}>
                    {fmt(cardCount)} cards
                  </span>{' '}
                  across {fmt(setCount)} sets, including{' '}
                  <span style={{ color: 'var(--amethyst-500, #6A43BE)', fontWeight: 700 }}>
                    {fmt(enchantedCount)} Enchanted
                  </span>{' '}
                  overprints.
                </>
              )}
            </p>
          </div>

          <div style={{ maxWidth: 520 }}>
            <HomeSearch />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link
              href="/card-finder"
              className="btn btn-primary"
              style={{ padding: '12px 20px', fontWeight: 700, fontSize: 14 }}
            >
              Find cards
            </Link>
            <Link
              href="/sign-up"
              className="btn"
              style={{
                padding: '12px 20px',
                fontWeight: 700,
                fontSize: 14,
                background: 'transparent',
                color: 'var(--text-strong)',
                border: '1.5px solid var(--border-strong)',
              }}
            >
              Create free account →
            </Link>
          </div>

          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-subtle)', maxWidth: 520 }}>
            Free forever. Track your holdings, save exact printings and
            know what your collection is worth.
          </p>
        </div>

        {/* ── RIGHT: real-data value module or collection CTA ── */}
        <aside style={{ minWidth: 0 }}>
          {topCard ? (
            <TopValueCard tile={topCard} />
          ) : (
            <CollectionCta />
          )}
        </aside>
      </div>
    </section>
  );
}

function TopValueCard({ tile }: { tile: DiscoveryTile }) {
  return (
    <Link
      href={`/card/${slugifyCardName(tile.name)}`}
      style={{
        display: 'block',
        borderRadius: 16,
        background:
          'linear-gradient(180deg, var(--surface, #FFFCF3) 0%, var(--surface-inset, #F5EAD6) 100%)',
        border: '1px solid var(--border, #E4D6BA)',
        boxShadow: '0 6px 24px rgba(74, 54, 22, 0.10)',
        padding: 18,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div className="label-mono" style={{ marginBottom: 10 }}>
        Most valuable right now
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ aspectRatio: '5 / 7', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {tile.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={tile.imageUrl} alt={tile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: 'var(--bg-strong)' }} />
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="lc-serif" style={{ fontSize: 20, lineHeight: 1.15, color: 'var(--text-strong)' }}>
            {tile.name}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {tile.rarity && (
              <span className={`treatment-badge treatment-badge--${(tile.rarity ?? '').toLowerCase()}`}>
                {tile.rarity}
              </span>
            )}
            {tile.setCode && (
              <span className="label-mono" style={{ color: 'var(--text-muted)' }}>
                {tile.setCode.toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{
              fontFamily: 'Outfit, system-ui, sans-serif',
              fontWeight: 800,
              fontSize: 28,
              color: 'var(--text-strong)',
              letterSpacing: '-0.02em',
            }}>
              {money(tile.priceUsd, tile.priceEur)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              live retail · Cardmarket EU
            </span>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            Tap to see every printing →
          </div>
        </div>
      </div>
    </Link>
  );
}

function CollectionCta() {
  return (
    <div
      style={{
        borderRadius: 16,
        background:
          'linear-gradient(180deg, var(--surface, #FFFCF3) 0%, var(--surface-inset, #F5EAD6) 100%)',
        border: '1px solid var(--border, #E4D6BA)',
        boxShadow: '0 6px 24px rgba(74, 54, 22, 0.10)',
        padding: 20,
      }}
    >
      <div className="label-mono" style={{ marginBottom: 10 }}>Build your Lorcana collection</div>
      <div className="lc-serif" style={{ fontSize: 22, lineHeight: 1.15, color: 'var(--text-strong)' }}>
        Track every card. Watch value grow.
      </div>
      <ul style={{ margin: '14px 0 18px', paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: 'var(--text-muted)' }}>
        <li>Save exact printings, foil vs nonfoil, Enchanted variants</li>
        <li>Live valuation across raw and graded holdings</li>
        <li>Free forever, no credit card, no login for browsing</li>
      </ul>
      <Link
        href="/sign-up"
        className="btn btn-primary"
        style={{ padding: '11px 18px', fontWeight: 700, fontSize: 14 }}
      >
        Create free account →
      </Link>
    </div>
  );
}
