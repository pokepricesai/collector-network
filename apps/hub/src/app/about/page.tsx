import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, SITE_URL, SITES } from '@/lib/sites';
import { ArrowRight, ArrowUpRight } from '@/components/icons';

export const metadata: Metadata = {
  title: `About ${SITE_NAME}`,
  description:
    'Collector Network is an independent group of specialist trading card platforms covering Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece and Disney Lorcana.',
  alternates: { canonical: `${SITE_URL}/about` },
};

export default function AboutPage() {
  return (
    <section className="section">
      <div className="container" style={{ display: 'grid', gap: 36, maxWidth: 780 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <span className="eyebrow">About</span>
          <h1>About {SITE_NAME}.</h1>
          <p className="lede">
            {SITE_NAME} is an independent group of specialist trading card
            platforms.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 14, fontSize: 16, color: 'var(--text-muted)' }}>
          <p>
            Rather than building one generic marketplace or database for every
            game, each platform is designed specifically around its own
            collecting community, cards, sets, pricing landscape and tools.
          </p>
          <p>
            The core idea is simple: specialist sites, shared infrastructure.
            Each site keeps its own voice; the technology, pricing feeds and
            collector tools behind the scenes are shared.
          </p>
        </div>

        <NetworkDiagram />

        <div style={{ display: 'grid', gap: 10 }}>
          <span className="eyebrow">Platforms</span>
          <h2>Five dedicated sites.</h2>
          <ul style={{ margin: '10px 0 0', paddingLeft: 20, lineHeight: 1.9, color: 'var(--text-muted)', fontSize: 15 }}>
            {SITES.map((s) => (
              <li key={s.slug}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 600 }}
                  aria-label={`${s.name} (opens in new tab)`}
                >
                  {s.name}
                  <ArrowUpRight style={{ width: 11, height: 11, color: 'var(--text-subtle)', verticalAlign: 'baseline', marginLeft: 4 }} />
                </a>
                <span>: {s.descriptor}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <span className="eyebrow">What we build</span>
          <ul style={{ margin: '12px 0 0', paddingLeft: 20, lineHeight: 1.9, color: 'var(--text-muted)', fontSize: 15 }}>
            <li>Card and set discovery</li>
            <li>Raw and graded pricing</li>
            <li>Market tracking</li>
            <li>Collection tools</li>
            <li>Collector insights</li>
            <li>Marketplace connections</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/partner" className="btn btn-primary">
            <span>Partner with us</span>
            <ArrowRight className="arrow" />
          </Link>
          <Link href="/contact" className="btn btn-ghost">Contact</Link>
        </div>
      </div>
    </section>
  );
}

function NetworkDiagram() {
  return (
    <div className="network-diagram" aria-hidden>
      <div className="network-diagram-inner">
        <span className="network-node-hub">
          <span className="nav-wordmark-dot" />
          Collector Network
        </span>
        <svg width="2" height="26" viewBox="0 0 2 26" aria-hidden>
          <line x1="1" y1="0" x2="1" y2="26" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="2 3" />
        </svg>
        <div className="network-nodes">
          {SITES.map((s) => (
            <span key={s.slug} className="network-node" style={{ borderColor: s.accent, color: 'var(--text)' }}>
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: s.accent,
                  marginRight: 8,
                  verticalAlign: 'middle',
                }}
              />
              {s.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
