import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { LORCANA_ARTICLES } from '@/lib/insights';
import { listNetworkArticles } from '@/server/network-articles';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title:
    'Lorcana market insights, rarity guides, chase-card analysis and collecting basics',
  description:
    'Editorial guides for Disney Lorcana collectors. Rarity explainers, chase-card tracking, collecting basics and the live top-price ranking.',
  alternates: { canonical: canonicalFor('/insights') },
};

interface Tile {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  tags: string[];
}

export default async function InsightsIndex() {
  const networkArticles = await listNetworkArticles();
  const registrySlugs = new Set(LORCANA_ARTICLES.map((a) => a.slug));
  const tiles: Tile[] = [
    ...LORCANA_ARTICLES.map((a) => ({
      slug: a.slug,
      title: a.title,
      description: a.description,
      publishedAt: a.publishedAt,
      tags: a.tags,
    })),
    ...networkArticles
      .filter((n) => !registrySlugs.has(n.slug))
      .map((n) => ({
        slug: n.slug,
        title: n.title,
        description: n.summary ?? '',
        publishedAt: n.publishedAt ?? n.updatedAt,
        tags: ['Editorial'] as string[],
      })),
  ].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

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
        {tiles.map((a) => (
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
              {a.description && (
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
                  {a.description}
                </p>
              )}
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
