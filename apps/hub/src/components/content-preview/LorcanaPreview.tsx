import type { PreviewArticle } from './types';
import { PreviewBodyStyles } from './OnepiecePreview';

// Mirrors apps/lorcana/src/app/insights/[slug]/page.tsx. Lorcana
// typography is slightly larger (17px body) and uses a serif for the
// H1 via the `lc-serif` class — serif swapped to a system fallback
// here since the hub does not ship the Lorcana font.

export function LorcanaPreview({ a }: { a: PreviewArticle }) {
  return (
    <div style={{
      background: '#F6F1E4',
      color: '#2A2140',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      minHeight: '100vh',
    }}>
      <LorcanaHeader />
      <section style={{ padding: '32px 24px 80px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <nav aria-label="Breadcrumb" style={{
            marginBottom: 12, fontSize: 13, color: '#6C5F8B',
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span>Home</span>
            <span aria-hidden>›</span>
            <span>Insights</span>
            <span aria-hidden>›</span>
            <span style={{ color: '#2A2140', fontWeight: 600 }}>{a.title}</span>
          </nav>

          {a.featuredImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.featuredImageUrl}
              alt={a.featuredImageAlt ?? ''}
              style={{ width: '100%', height: 'auto', maxHeight: 340, objectFit: 'cover', borderRadius: 14, marginBottom: 16 }}
            />
          )}

          <h1 style={{
            margin: '4px 0 8px', fontSize: 34, lineHeight: 1.15,
            letterSpacing: '-0.01em',
            fontFamily: 'Georgia, "Times New Roman", serif',
            color: '#1F1836',
          }}>
            {a.title}
          </h1>
          {(a.standfirst || a.summary) && (
            <p style={{ margin: 0, color: '#5C517A', fontSize: 15, lineHeight: 1.6 }}>
              {a.standfirst ?? a.summary}
            </p>
          )}
          <p style={{ marginTop: 10, color: '#6C5F8B', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
            {a.publishedAt ? fmt(a.publishedAt) : 'Preview'}
            {a.author ? ` · ${a.author}` : ''}
          </p>

          <article
            className="article-body"
            style={{
              marginTop: 24, fontSize: 17, lineHeight: 1.7,
              color: '#2A2140',
            }}
            dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
          />

          <hr style={{ marginTop: 40, border: 'none', borderTop: '1px solid #D9CFBA' }} />
          <p style={{ marginTop: 16, color: '#6C5F8B', fontSize: 12, lineHeight: 1.6 }}>
            Prices via Cardmarket EU. LorcanaPrices does not apply a
            hardcoded FX conversion.
          </p>
        </div>
      </section>
      <PreviewBodyStyles accentColor="#9B7AC6" />
    </div>
  );
}

function LorcanaHeader() {
  return (
    <header style={{
      borderBottom: '1px solid #E6DBC0',
      padding: '12px 24px',
      background: '#F6F1E4',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{
        fontWeight: 800, fontSize: 18, color: '#1F1836',
        letterSpacing: '-0.01em',
        fontFamily: 'Georgia, "Times New Roman", serif',
        display: 'flex', alignItems: 'baseline', gap: 2,
      }}>
        <span>Lorcana</span><span style={{ color: '#9B7AC6' }}>Prices</span>
      </div>
      <nav style={{ display: 'flex', gap: 14, fontSize: 13, color: '#6C5F8B' }}>
        <span>Browse</span>
        <span>Sets</span>
        <span>Enchanted</span>
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
