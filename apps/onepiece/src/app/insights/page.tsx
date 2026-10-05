import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { OP_ARTICLES } from '@/lib/articles';
import { listNetworkArticles } from '@/server/network-articles';

// Real /insights index. Enumerates the launch articles PLUS any
// Collector Network OS articles published to onepiece_db.
export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'One Piece market insights. Articles, guides and analysis',
  description:
    'Editorial coverage of the One Piece Card Game market: which cards are most valuable, how the rarity ladder works, and how to start a serious collection.',
  alternates: { canonical: canonicalFor('/insights') },
};

interface TileArticle {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  publishedIso: string;
  readingMinutes: number;
}

function minutesForWords(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 220));
}

export default async function InsightsIndex() {
  const canonical = canonicalFor('/insights');
  const networkArticles = await listNetworkArticles();
  const registrySlugs = new Set(OP_ARTICLES.map((a) => a.slug));
  const networkTiles: TileArticle[] = networkArticles
    .filter((n) => !registrySlugs.has(n.slug))
    .map((n) => ({
      slug: n.slug,
      title: n.title,
      category: 'Editorial',
      excerpt: n.summary ?? '',
      publishedIso: n.publishedAt ?? n.updatedAt,
      readingMinutes: minutesForWords((n.summary ?? '').split(/\s+/).length * 4 || 400),
    }));
  const allTiles: TileArticle[] = [
    ...OP_ARTICLES.map((a) => ({
      slug: a.slug,
      title: a.title,
      category: a.category,
      excerpt: a.excerpt,
      publishedIso: a.publishedIso,
      readingMinutes: a.readingMinutes,
    })),
    ...networkTiles,
  ].sort((a, b) => (b.publishedIso ?? '').localeCompare(a.publishedIso ?? ''));

  const listLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'OnePiecePrices Insights',
    url: canonical,
    hasPart: allTiles.map((a) => ({
      '@type': 'Article',
      headline: a.title,
      url: canonicalFor(`/insights/${a.slug}`),
      datePublished: a.publishedIso,
    })),
  };

  return (
    <div style={{ padding: '32px 24px 64px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }}
      />
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Insights</div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Editorial from the One Piece market
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
              Grounded write-ups tied to live pricing. Every article links
              back into the catalogue so the numbers stay honest as prices
              move.
            </p>
          </div>
        </header>

        <div style={{
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
        }}>
          {allTiles.map((a) => (
            <Link key={a.slug} href={`/insights/${a.slug}`} style={tileStyle}>
              <div className="label-mono" style={{ color: 'var(--gold-600)' }}>{a.category}</div>
              <h2 style={{ margin: '4px 0 6px', fontSize: 19, lineHeight: 1.3, color: 'var(--text-strong)' }}>
                {a.title}
              </h2>
              {a.excerpt && (
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  {a.excerpt}
                </p>
              )}
              <div style={{ marginTop: 10, display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>{formatDate(a.publishedIso)}</span>
                <span aria-hidden>·</span>
                <span>{a.readingMinutes} min read</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}

const tileStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 18,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  textDecoration: 'none',
  color: 'var(--text)',
  boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
};
