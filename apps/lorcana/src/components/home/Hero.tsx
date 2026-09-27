import HomeSearch from '@/components/HomeSearch';
import Link from 'next/link';
import { LC_INKS, LC_INK_LABEL } from '@/lib/lorcana/ink';

// Homepage hero. Deliberately concise: three-line headline, one search
// input, six ink chips and three CTAs. Everything else lives in
// modules below the fold.

interface HeroProps {
  cardCount: number;
  setCount: number;
  enchantedCount: number;
}

export default function Hero({ cardCount, setCount, enchantedCount }: HeroProps) {
  return (
    <section className="lc-hero">
      <div className="lc-ink-wheel" aria-hidden />
      <div className="spark-field" aria-hidden />

      <div className="lc-container" style={{ position: 'relative', zIndex: 1, maxWidth: 900 }}>
        <div style={{ textAlign: 'center', display: 'grid', gap: 18, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <span className="badge-prestige animate-in">
              Live Lorcana prices · Enchanted · Iconic
            </span>
          </div>

          <h1 style={{ letterSpacing: '-0.02em' }}>
            Every printing.<br />
            <span className="gold-text">Every Enchanted.</span><br />
            One collector-grade catalogue.
          </h1>

          <p style={{
            margin: '0 auto',
            maxWidth: 640,
            fontSize: 'var(--step-1)',
            color: 'var(--text-muted)',
            lineHeight: 1.55,
            padding: '0 4px',
          }}>
            {cardCount > 0 ? (
              <>
                Track {fmt(cardCount)} cards across {fmt(setCount)} sets — including{' '}
                <span style={{ color: 'var(--amethyst-500)', fontWeight: 700 }}>
                  {fmt(enchantedCount)} Enchanted
                </span>{' '}
                overprints. Foil and nonfoil priced independently.
              </>
            ) : (
              <>Live Disney Lorcana card prices — Enchanted, Iconic, Epic, Legendary and Promo cards priced individually across foil and nonfoil.</>
            )}
          </p>

          <div style={{ maxWidth: 560, width: '100%', margin: '0 auto' }}>
            <HomeSearch />
          </div>

          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
            padding: '0 4px',
          }}>
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

          <div style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            flexWrap: 'wrap',
            padding: '0 4px',
          }}>
            <Link href="/browse" className="btn btn-primary">
              Browse sets
            </Link>
            <Link href="/market/enchanted" className="btn btn-gold">
              Enchanted chase
            </Link>
            <Link href="/card-finder" className="btn btn-ghost">
              Card Finder
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}
