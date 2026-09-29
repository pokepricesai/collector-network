import HomeSearch from '@/components/HomeSearch';
import Link from 'next/link';
import type { OpFinderTile } from '@/server/finder';
import { formatPrice } from '@/lib/onepiece/currency';

// Homepage hero — nautical / adventurous framing without borrowing
// publisher artwork or trademarks. Two-column at wide viewports:
//
//   Left column: title, subtitle, search, "Find cards" primary CTA,
//                "Create free account" gold CTA, collection benefit
//                copy, colour explorer chips.
//   Right column: live top-value Leaders module (5 real cards fetched
//                 server-side; each links to its logical card page).
//
// Below 900px the columns stack; the Leaders module sits above the
// colour chips so it remains a first-fold module even on mobile.

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
  topLeaders,
}: {
  cardCount: number;
  setCount: number;
  topLeaders: OpFinderTile[];
}) {
  return (
    <section
      className="hero-shell op-hero-shell"
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <CompassRose />

      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
          padding: '32px 24px',
          display: 'grid',
          gap: 26,
          gridTemplateColumns: '1fr',
        }}
        className="op-hero-grid"
      >
        {/* Left column */}
        <div style={{ display: 'grid', gap: 22 }}>
          <div>
            <span className="badge-prestige" style={{ marginBottom: 10, display: 'inline-block' }}>
              Chart the map · Every printing priced
            </span>
            <h1
              style={{
                fontSize: 'clamp(30px, 5vw, 52px)',
                margin: 0,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: 'var(--text-strong)',
                fontFamily: 'Outfit, system-ui, sans-serif',
              }}
            >
              Set sail through the{' '}
              <span className="gold-text">whole catalogue</span>.
            </h1>
            <p
              style={{
                margin: '14px 0 0',
                fontSize: 16,
                color: 'var(--text-muted)',
                lineHeight: 1.55,
                maxWidth: 520,
              }}
            >
              {cardCount > 0 && setCount > 0 ? (
                <>
                  {formatNumber(cardCount)} One Piece Card Game cards across{' '}
                  {formatNumber(setCount)} sets. Standards, parallels, secret
                  rares, special cards and treasure rares. Each priced
                  individually.
                </>
              ) : (
                <>Every One Piece Card Game printing, priced individually.</>
              )}
            </p>
          </div>

          <div style={{ maxWidth: 540 }}>
            <HomeSearch />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link href="/card-finder" className="btn btn-primary" style={{
              padding: '12px 22px', borderRadius: 12, fontSize: 14, fontWeight: 700, textDecoration: 'none',
              letterSpacing: '0.02em',
            }}>
              Find cards →
            </Link>
            <Link href="/sign-up" className="btn btn-gold" style={{
              padding: '12px 22px', borderRadius: 12, fontSize: 14, fontWeight: 800, textDecoration: 'none',
              letterSpacing: '0.02em',
            }}>
              Create free account
            </Link>
          </div>

          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, maxWidth: 520, lineHeight: 1.55 }}>
            A free account lets you save any exact printing. Foil, treatment
            and grade. With live valuation on the same data the rest of the
            site uses. Only you see your holdings.
          </p>

          <div>
            <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 6 }}>
              Explore by colour
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
        </div>

        {/* Right column — live Valuable Leaders module */}
        <aside style={leaderModuleStyle}>
          <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Live · Right now</div>
          <h2 style={{ margin: '4px 0 6px', fontSize: 20 }}>Most valuable Leaders</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.5 }}>
            Top five priced Leader printings in the live retail feed.
            Every price is EUR from Cardmarket EU.
          </p>
          {topLeaders.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Live Leader prices are refreshing. Check back in a moment.
            </div>
          ) : (
            <ol style={{ padding: 0, margin: '0 0 10px', listStyle: 'none', display: 'grid', gap: 6 }}>
              {topLeaders.map((t, i) => (
                <li key={t.cardId}>
                  <Link href={t.href} style={leaderRowStyle}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>
                        #{i + 1}
                      </span>
                      <span style={{ display: 'grid', minWidth: 0 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.name}
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {(t.set?.code ?? '').toUpperCase()} · {t.collectorNumber}
                        </span>
                      </span>
                    </span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 13 }}>
                      {formatPrice(t.price, t.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          <div style={{ marginTop: 6 }}>
            <Link href="/leaders?sort=price-desc" style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-600)', textDecoration: 'none' }}>
              See every Leader ranked →
            </Link>
          </div>
        </aside>
      </div>

      <style>{`
        @media (min-width: 900px) {
          .op-hero-grid { grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr) !important; align-items: start; }
        }
      `}</style>
    </section>
  );
}

// A soft compass-rose glyph anchored top-right. Pure CSS/SVG — no
// external asset, no publisher-trademarked imagery.
function CompassRose() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      style={{
        position: 'absolute',
        right: -40,
        top: -40,
        width: 340,
        height: 340,
        opacity: 0.08,
        pointerEvents: 'none',
        color: 'var(--gold-600)',
      }}
    >
      <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="0.8" />
      <path d="M100 12 L108 100 L100 108 L92 100 Z" fill="currentColor"/>
      <path d="M100 188 L108 100 L100 92 L92 100 Z" fill="currentColor"/>
      <path d="M12 100 L100 108 L108 100 L100 92 Z" fill="currentColor"/>
      <path d="M188 100 L100 108 L92 100 L100 92 Z" fill="currentColor"/>
      <circle cx="100" cy="100" r="6" fill="currentColor" />
      {Array.from({ length: 32 }).map((_, i) => {
        const angle = (i / 32) * Math.PI * 2;
        const inner = 78, outer = 88;
        const x1 = 100 + Math.cos(angle) * inner;
        const y1 = 100 + Math.sin(angle) * inner;
        const x2 = 100 + Math.cos(angle) * outer;
        const y2 = 100 + Math.sin(angle) * outer;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1" />;
      })}
    </svg>
  );
}

const leaderModuleStyle: React.CSSProperties = {
  padding: 18,
  background: 'linear-gradient(180deg, rgba(220,38,38,0.06) 0%, rgba(220,38,38,0) 60%), var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
};

const leaderRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'center',
  padding: '8px 10px',
  background: 'var(--bg-light)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  textDecoration: 'none',
  color: 'var(--text)',
};

function formatNumber(n: number): string {
  if (n <= 0) return '–';
  if (n >= 1000) return new Intl.NumberFormat('en-US').format(n);
  return String(n);
}
