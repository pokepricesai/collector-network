import type { PreviewArticle } from './types';
import { PreviewBodyStyles } from './OnepiecePreview';

// Mirrors apps/yugioh/src/app/insights/[slug]/page.tsx. The real YGO
// site renders inside a Header + Footer plus a 820px (network) / 780
// (registry) max-width body. The preview uses 780 since the editorial
// workflow is for network-authored articles.

export function YgoPreview({ a }: { a: PreviewArticle }) {
  return (
    <div style={{
      background: '#FFFFFF',
      color: '#111827',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      minHeight: '100vh',
    }}>
      <YgoHeader />
      <main style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px' }}>
        <nav aria-label="Breadcrumb" style={{
          marginBottom: 12, fontSize: 13, color: '#6B7280',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span>Home</span>
          <span aria-hidden>›</span>
          <span>Insights</span>
          <span aria-hidden>›</span>
          <span style={{ color: '#111827', fontWeight: 600 }}>{a.title}</span>
        </nav>

        {a.featuredImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={a.featuredImageUrl}
            alt={a.featuredImageAlt ?? ''}
            style={{ width: '100%', height: 'auto', maxHeight: 340, objectFit: 'cover', borderRadius: 10, marginBottom: 16 }}
          />
        )}

        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#B78A0F',
        }}>Editorial</div>
        <h1 style={{ margin: '4px 0 8px', fontSize: 34, lineHeight: 1.15, letterSpacing: '-0.01em' }}>
          {a.title}
        </h1>
        {(a.standfirst || a.summary) && (
          <p style={{ margin: 0, color: '#6B7280', fontSize: 15, lineHeight: 1.55 }}>
            {a.standfirst ?? a.summary}
          </p>
        )}
        <p style={{ marginTop: 8, color: '#6B7280', fontSize: 13 }}>
          {a.publishedAt ? `Published ${fmt(a.publishedAt)}` : <em style={{ fontStyle: 'italic' }}>Preview (unpublished)</em>}
          {a.publishedAt && a.updatedAt && a.updatedAt !== a.publishedAt ? ` · Updated ${fmt(a.updatedAt)}` : null}
          {a.author ? ` · ${a.author}` : ''}
        </p>

        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 8,
          background: '#F9FAFB', fontSize: 12, color: '#6B7280',
          border: '1px solid #E5E7EB',
        }}>
          Live prices in this article come from the daily production
          feed (TCGplayer USD and Cardmarket EU) and can shift between
          visits. If a specific number matters to you, open the linked
          card page for the current value.
        </div>

        <article
          className="article-body"
          style={{ marginTop: 24, fontSize: 15, lineHeight: 1.7, color: '#111827' }}
          dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
        />

        <hr style={{ marginTop: 40, border: 'none', borderTop: '1px solid #E5E7EB' }} />
        <p style={{ marginTop: 16, color: '#6B7280', fontSize: 12, lineHeight: 1.6 }}>
          Prices are shown in USD (TCGplayer) or EUR (Cardmarket EU).
          YGOPrices never applies a hardcoded FX conversion.
        </p>
      </main>
      <PreviewBodyStyles accentColor="#B78A0F" />
    </div>
  );
}

function YgoHeader() {
  return (
    <header style={{
      borderBottom: '1px solid #E5E7EB',
      padding: '12px 24px',
      background: '#FFFFFF',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{
        fontWeight: 800, fontSize: 18, color: '#111827',
        letterSpacing: '-0.01em', display: 'flex', alignItems: 'baseline', gap: 2,
      }}>
        <span>YGO</span><span style={{ color: '#B78A0F' }}>Prices</span>
      </div>
      <nav style={{ display: 'flex', gap: 14, fontSize: 13, color: '#6B7280' }}>
        <span>Browse</span>
        <span>Decks</span>
        <span>Market</span>
        <span>Insights</span>
      </nav>
    </header>
  );
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}
