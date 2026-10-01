import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, SITE_URL, SITES } from '@/lib/sites';

export const metadata: Metadata = {
  title: `About ${SITE_NAME}`,
  description:
    'Collector Network is an independent group of specialist trading card platforms covering Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece and Disney Lorcana.',
  alternates: { canonical: `${SITE_URL}/about` },
};

export default function AboutPage() {
  return (
    <section className="section">
      <div className="container" style={{ display: 'grid', gap: 32, maxWidth: 760 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <h1>About {SITE_NAME}</h1>
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

        <div style={{ display: 'grid', gap: 10 }}>
          <h2>Platforms</h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, color: 'var(--text-muted)', fontSize: 15 }}>
            {SITES.map((s) => (
              <li key={s.slug}>
                <a href={s.href} rel="noopener" style={{ color: 'var(--text)' }}>{s.name}</a>
                <span>: {s.descriptor}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>What we build</h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, color: 'var(--text-muted)', fontSize: 15 }}>
            <li>Card and set discovery</li>
            <li>Raw and graded pricing</li>
            <li>Market tracking</li>
            <li>Collection tools</li>
            <li>Collector insights</li>
            <li>Marketplace connections</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/partner" className="btn btn-primary">Partner with us</Link>
          <Link href="/contact" className="btn btn-ghost">Contact</Link>
        </div>
      </div>
    </section>
  );
}
