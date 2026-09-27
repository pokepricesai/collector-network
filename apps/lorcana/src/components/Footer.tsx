import Link from 'next/link';
import Image from 'next/image';

// Site footer. Groups live routes by product area and carries the
// Ravensburger / Disney unofficial-use disclaimer.

const cardsLinks = [
  { label: 'Search cards', href: '/cards/search' },
  { label: 'Browse sets',  href: '/browse' },
  { label: 'Card Finder',  href: '/card-finder' },
  { label: 'Inks',         href: '/inks' },
];

const marketLinks = [
  { label: 'Market movers',    href: '/market' },
  { label: 'Enchanted chase',  href: '/market#enchanted' },
  { label: 'Iconic overprints',href: '/market#iconic' },
  { label: 'Most valuable',    href: '/market#most-valuable' },
];

const insightLinks = [
  { label: 'Latest insights', href: '/insights' },
];

const companyLinks = [
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms',   href: '/terms' },
];

export default function Footer() {
  return (
    <footer
      style={{
        background:
          'linear-gradient(180deg, var(--surface) 0%, var(--bg-light) 100%)',
        borderTop: '1px solid var(--border-light)',
        padding: '48px 24px 32px',
        marginTop: 60,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background:
            'linear-gradient(90deg, transparent 0%, rgba(185,138,58,0.35) 20%, rgba(122,78,240,0.35) 50%, rgba(185,138,58,0.35) 80%, transparent 100%)',
        }}
      />

      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
            gap: 32,
            marginBottom: 36,
          }}
        >
          <div style={{ maxWidth: 320 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <Image
                src="/emblem-256.png"
                alt=""
                aria-hidden
                width={256}
                height={256}
                className="lc-footer-emblem"
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span
                  style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 800,
                    fontSize: 20,
                    color: 'var(--text-strong)',
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                  }}
                >
                  Lorcana<span style={{ color: 'var(--accent-2)' }}>Prices</span>
                </span>
                <span className="label-mono" style={{ marginTop: 6 }}>
                  Prices · Inks · Enchanted chase
                </span>
              </div>
            </div>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: 13,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Live Disney Lorcana prices and chase treatments. Every Enchanted,
              Iconic, Epic, Legendary and Promo card is listed as its own
              priced entity, alongside a complete set catalogue, the six-ink
              discovery board and a graded-price panel.
            </p>
          </div>

          <FooterColumn title="Cards"   links={cardsLinks}    />
          <FooterColumn title="Market"  links={marketLinks}   />
          <FooterColumn title="Read"    links={insightLinks}  />
          <FooterColumn title="Company" links={companyLinks}  />
        </div>

        <div className="gilt-divider" aria-hidden />

        <div
          style={{
            paddingTop: 24,
            marginTop: 4,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 11.5,
              margin: 0,
              maxWidth: 780,
              lineHeight: 1.65,
            }}
          >
            Disney Lorcana and all associated card imagery, character names and
            trademarks © Disney and Ravensburger. This site is unofficial and
            not affiliated with, endorsed, sponsored, or specifically approved
            by Disney, Ravensburger or their partners. Retail price feeds
            attributed to their respective providers. Informational only. Not
            financial advice.
          </p>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            © {new Date().getFullYear()} LorcanaPrices
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p
        style={{
          color: 'var(--accent-2)',
          fontSize: 11,
          marginBottom: 14,
          marginTop: 0,
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          fontWeight: 700,
        }}
      >
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            style={{
              color: 'var(--text)',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
