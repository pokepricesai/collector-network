import Link from 'next/link';
import Image from 'next/image';

// Site footer. Groups live routes by product area, and preserves
// Bandai IP attribution. Cousin file on MTGPrices carries WotC
// attribution; each specialist site owns its own footer copy.

const cardsLinks = [
  { label: 'Search cards', href: '/cards/search' },
  { label: 'Browse sets',  href: '/browse' },
  { label: 'Card Finder',  href: '/card-finder' },
  { label: 'Colours',      href: '/colours' },
];

const marketLinks = [
  { label: 'Market movers', href: '/market' },
  { label: 'Chase cards',   href: '/market#chase' },
  { label: 'Manga rares',   href: '/market#manga-rares' },
];

const insightLinks = [
  { label: 'Latest insights', href: '/insights' },
  { label: 'Leaders',         href: '/leaders' },
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
            'linear-gradient(90deg, transparent 0%, rgba(233,178,58,0.35) 20%, rgba(233,178,58,0.35) 80%, transparent 100%)',
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
          <div style={{ maxWidth: 300 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Image
                src="/emblem-64.png"
                alt=""
                aria-hidden
                width={64}
                height={64}
                className="op-footer-emblem"
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span
                  style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 800,
                    fontSize: 18,
                    color: 'var(--text-strong)',
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                  }}
                >
                  OnePiecePrices
                </span>
                <span className="label-mono" style={{ marginTop: 4 }}>
                  Prices · Treatments · Sets
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
              Live One Piece Card Game prices and treatments. Every parallel, alternate
              art, manga rare and secret rare listed as its own priced entity, alongside
              a complete set catalogue and market-movers board.
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
            One Piece, One Piece Card Game and card images © Bandai / Shueisha /
            Toei Animation / Eiichiro Oda. This site is unofficial and not affiliated
            with, endorsed, sponsored, or specifically approved by Bandai or its
            partners. Retail price feeds attributed to their respective providers.
            Informational only. Not financial advice.
          </p>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            © {new Date().getFullYear()} OnePiecePrices.io
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
          color: 'var(--gold-600)',
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
