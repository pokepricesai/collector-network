import HomeSearch from '@/components/HomeSearch';
import Link from 'next/link';
import { LC_INKS, LC_INK_LABEL } from '@/lib/lorcana/ink';

// Homepage hero. Warm parchment + a shimmer of the six-ink wheel behind.
// Two primary CTAs: "Browse sets" and "See movers". Below the search
// input a row of ink chips lets a first-time visitor filter by ink in
// one click.

export default function Hero({
  cardCount,
  setCount,
}: {
  cardCount: number;
  setCount: number;
}) {
  return (
    <section
      className="hero-shell lc-hero-shell"
      style={{ position: 'relative' }}
    >
      <div className="lc-ink-wheel" aria-hidden />
      <div className="spark-field" aria-hidden />

      <div
        style={{
          maxWidth: 980,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 26,
        }}
      >
        <div style={{ textAlign: 'center', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
          <span
            className="badge-prestige"
            style={{ margin: '0 auto', animation: 'fadeInUp 0.4s ease-out' }}
          >
            Live Lorcana prices · Inks · Enchanted chase
          </span>
          <h1
            className="lc-hero-h1"
            style={{
              fontSize: 'clamp(24px, 5.6vw, 46px)',
              margin: 0,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              color: 'var(--text-strong)',
            }}
          >
            Every printing.
            <br />
            <span className="gold-text">Every Enchanted.</span>
            <br />
            One catalogue.
          </h1>
          <p className="lc-hero-copy">
            {cardCount > 0 && setCount > 0 ? (
              <>
                Track {formatNumber(cardCount)} cards across{' '}
                {formatNumber(setCount)} sets.
              </>
            ) : (
              <>Track every Disney Lorcana card.</>
            )}{' '}
            Foil and nonfoil, Enchanted, Iconic, Epic and Promo drops
            are each priced individually — an Enchanted overprint never
            gets buried under its base rarity.
          </p>
        </div>

        <div style={{ maxWidth: 620, width: '100%', margin: '0 auto' }}>
          <HomeSearch />
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginTop: 12,
              justifyContent: 'center',
            }}
          >
            {LC_INKS.map((ink) => (
              <Link
                key={ink}
                href={`/inks/${ink}`}
                className={`chip chip-ink chip-ink--${ink}`}
                style={{ textDecoration: 'none' }}
              >
                {LC_INK_LABEL[ink]}
              </Link>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link href="/browse" className="btn btn-primary">
            Browse sets
          </Link>
          <Link href="/market" className="btn btn-gold">
            See top movers
          </Link>
          <Link href="/card-finder" className="btn btn-ghost">
            Card Finder
          </Link>
        </div>
      </div>
    </section>
  );
}

function formatNumber(n: number): string {
  if (n <= 0) return '—';
  if (n >= 1000) return new Intl.NumberFormat('en-US').format(n);
  return String(n);
}
