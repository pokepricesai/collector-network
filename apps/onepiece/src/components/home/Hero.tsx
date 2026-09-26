import HomeSearch from '@/components/HomeSearch';
import Link from 'next/link';

// Homepage hero. Warm ivory + a soft OP colour crest behind. Two
// primary CTAs: "Browse sets" and "See movers". Below the search input
// a scrollable set of colour chips lets a first-time visitor filter
// by colour in one click.

const COLOUR_CHIPS: { label: string; hue: string; href: string }[] = [
  { label: 'Red',    hue: 'red',    href: '/colours/red' },
  { label: 'Green',  hue: 'green',  href: '/colours/green' },
  { label: 'Blue',   hue: 'blue',   href: '/colours/blue' },
  { label: 'Purple', hue: 'purple', href: '/colours/purple' },
  { label: 'Black',  hue: 'black',  href: '/colours/black' },
  { label: 'Yellow', hue: 'yellow', href: '/colours/yellow' },
];

export default function Hero({
  cardCount,
  setCount,
}: {
  cardCount: number;
  setCount: number;
}) {
  return (
    <section
      className="hero-shell op-hero-shell"
      style={{ position: 'relative' }}
    >
      <div className="op-colour-crest" aria-hidden />
      <div className="spark-field" aria-hidden />

      <div
        style={{
          maxWidth: 980,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gap: 26,
        }}
      >
        <div style={{ textAlign: 'center', display: 'grid', gap: 14 }}>
          <span
            className="badge-prestige"
            style={{ margin: '0 auto', animation: 'fadeInUp 0.4s ease-out' }}
          >
            Live One Piece prices · Treatments · Sets
          </span>
          <h1
            style={{
              fontSize: 'clamp(22px, 4.6vw, 46px)',
              margin: 0,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              color: 'var(--text-strong)',
            }}
          >
            Every printing.
            <br />
            <span className="gold-text">Every treatment.</span>
            <br />
            One collector-grade catalogue.
          </h1>
          <p
            style={{
              maxWidth: 720,
              margin: '0 auto',
              fontSize: 16.5,
              color: 'var(--text-muted)',
              lineHeight: 1.55,
            }}
          >
            {cardCount > 0 && setCount > 0 ? (
              <>
                Track {formatNumber(cardCount)} cards across{' '}
                {formatNumber(setCount)} sets.
              </>
            ) : (
              <>Track every One Piece Card Game printing.</>
            )}{' '}
            Standards, parallels, secret rares, special cards and treasure
            rares are each priced individually — a chase card never gets
            buried under a common.
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
            {COLOUR_CHIPS.map((c) => (
              <Link
                key={c.hue}
                href={c.href}
                className={`chip chip-${c.hue}`}
                style={{ textDecoration: 'none' }}
              >
                {c.label}
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
