import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';
import { siteUrl } from '../../lib/site-url';
import { YGO_ARTICLES } from '../../lib/articles';

// Public /insights index. Enumerates the three launch articles.
// Indexable per site policy — carries CollectionPage JSON-LD listing
// the child Article URLs.

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  title: 'YGOPrices insights. Yu-Gi-Oh! market analysis and collector guides',
  description:
    'Editorial coverage of the Yu-Gi-Oh! market and collecting: most valuable cards, rarity explainers, and a collector guide to sets, editions and prices.',
  alternates: { canonical: `${SITE_URL}/insights` },
  openGraph: {
    title: 'YGOPrices Insights',
    description:
      'Editorial coverage of the Yu-Gi-Oh! market and collecting.',
    url: `${SITE_URL}/insights`,
    type: 'website',
  },
};

export default function InsightsIndex() {
  const canonical = `${SITE_URL}/insights`;
  const listLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'YGOPrices Insights',
    url: canonical,
    hasPart: YGO_ARTICLES.map((a) => ({
      '@type': 'Article',
      headline: a.title,
      url: `${SITE_URL}/insights/${a.slug}`,
      datePublished: a.publishedIso,
      dateModified: a.updatedIso,
    })),
  };

  return (
    <>
      <Header compactSearch />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 24px 64px' }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--ygo-accent-gold-strong, #B78A0F)',
          }}>Insights</div>
          <h1 style={{ margin: '4px 0 6px', fontSize: 30, letterSpacing: '-0.01em' }}>
            Editorial from the Yu-Gi-Oh! market
          </h1>
          <p style={{ margin: 0, color: 'var(--ygo-text-muted, #6B7280)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
            Grounded write-ups tied to live pricing. Every article
            links back into the catalogue so the numbers stay honest
            as prices move.
          </p>
        </header>

        <div style={{
          display: 'grid', gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}>
          {YGO_ARTICLES.map((a) => (
            <Link
              key={a.slug}
              href={`/insights/${a.slug}`}
              style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                padding: 18,
                background: 'var(--ygo-surface, #FFF)',
                border: '1px solid var(--ygo-border, #E5E7EB)',
                borderRadius: 14,
                textDecoration: 'none',
                color: 'var(--ygo-text, #111827)',
                boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
              }}
            >
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: 'var(--ygo-accent-gold-strong, #B78A0F)',
              }}>{a.category}</div>
              <h2 style={{ margin: '4px 0 6px', fontSize: 19, lineHeight: 1.3 }}>
                {a.title}
              </h2>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ygo-text-muted, #6B7280)', lineHeight: 1.55 }}>
                {a.excerpt}
              </p>
              <div style={{ marginTop: 10, display: 'flex', gap: 10, fontSize: 11, color: 'var(--ygo-text-muted, #6B7280)' }}>
                <span>{formatDate(a.publishedIso)}</span>
                <span aria-hidden>·</span>
                <span>{a.readingMinutes} min read</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}
