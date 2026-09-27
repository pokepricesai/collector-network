import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { LORCANA_ARTICLES } from '@/lib/insights';

export const metadata: Metadata = {
  title:
    'Lorcana market insights — rarity guides, chase-card analysis and collecting basics',
  description:
    'Editorial guides for Disney Lorcana collectors. Rarity explainers, chase-card tracking, collecting basics and the live top-price ranking.',
  alternates: { canonical: canonicalFor('/insights') },
};

export default function InsightsIndex() {
  return (
    <div className="lc-container lc-section" style={{ maxWidth: 900 }}>
      <header className="lc-page-hero" style={{ marginBottom: 24 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="label-mono" style={{ color: 'var(--accent-2)' }}>Insights</div>
          <h1 className="lc-serif" style={{ margin: '4px 0 6px', fontSize: 34, letterSpacing: '-0.01em' }}>
            Guides for Lorcana collectors
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
            Rarity explainers, chase-card analysis and collecting basics.
            Every article links straight to live LorcanaPrices card and set
            pages so the numbers move with the market.
          </p>
        </div>
      </header>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 14 }}>
        {LORCANA_ARTICLES.map((a) => (
          <li key={a.slug}>
            <Link
              href={`/insights/${a.slug}`}
              style={{
                display: 'block',
                padding: 18,
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div className="label-mono" style={{ marginBottom: 6 }}>
                {new Date(a.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
              <h2 className="lc-serif" style={{ margin: '0 0 8px', fontSize: 22, letterSpacing: '-0.01em' }}>
                {a.title}
              </h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
                {a.description}
              </p>
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {a.tags.map((t) => (
                  <span key={t} className="chip" style={{ fontSize: 11 }}>
                    {t}
                  </span>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
