import type { PreviewArticle } from './types';
import { PreviewBodyStyles } from './OnepiecePreview';

// Mirrors the MTGPrices insights shell — 780px column, warm ivory
// background, arcane-blue primary, burnished-gold accent on the
// category chip + blockquote. H1 scales via clamp() like the real
// template.

export function MtgPreview({ a }: { a: PreviewArticle }) {
  return (
    <div style={{
      background: '#F6F1E4',
      color: '#14213D',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      minHeight: '100vh',
    }}>
      <MtgHeader />
      <div style={{ padding: '32px 24px 80px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <nav aria-label="Breadcrumb" style={{
            marginBottom: 12, fontSize: 12, color: '#6E7C98',
            display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span>Home</span>
            <span aria-hidden>›</span>
            <span>Insights</span>
            <span aria-hidden>›</span>
            <span style={{ color: '#14213D', fontWeight: 600 }}>{a.title}</span>
          </nav>

          {a.featuredImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.featuredImageUrl}
              alt={a.featuredImageAlt ?? ''}
              style={{ width: '100%', height: 'auto', maxHeight: 340, objectFit: 'cover', borderRadius: 10, marginBottom: 16, border: '1px solid #E6DBC0' }}
            />
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '6px 0', fontSize: 11 }}>
            <span style={{
              padding: '3px 10px', background: '#F6F1E4', color: '#D18A2E',
              border: '1px solid #D18A2E',
              borderRadius: 999, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em',
            }}>Arcane</span>
            <span style={{ color: '#6E7C98' }}>
              {a.publishedAt ? fmt(a.publishedAt) : 'Preview'}
              {a.author ? ` · ${a.author}` : ''}
            </span>
          </div>

          <h1 style={{
            margin: '0 0 10px',
            fontSize: 'clamp(28px, 3.4vw, 40px)',
            fontWeight: 800, lineHeight: 1.15,
            letterSpacing: '-0.01em',
            color: '#14213D',
          }}>
            {a.title}
          </h1>

          {(a.standfirst || a.summary) && (
            <p style={{
              margin: '0 0 18px', fontSize: 17, lineHeight: 1.55,
              color: '#4A5879',
            }}>
              {a.standfirst ?? a.summary}
            </p>
          )}

          <article
            className="article-body"
            style={{ fontSize: 16.5, lineHeight: 1.75, color: '#14213D' }}
            dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
          />

          <hr style={{ marginTop: 36, border: 'none', borderTop: '1px solid #E6DBC0' }} />
          <p style={{ marginTop: 14, color: '#6E7C98', fontSize: 12 }}>
            Prices via MTGPrices. Affiliate links may appear elsewhere
            on the site.
          </p>
        </div>
      </div>
      <PreviewBodyStyles accentColor="#235FAE" />
      <style dangerouslySetInnerHTML={{
        __html: `
          .article-body blockquote { border-left-color: #D18A2E; background: #F3EBD4; }
          .article-body h2 { font-size: 24px; }
          .article-body h3 { font-size: 19px; }
        `,
      }} />
    </div>
  );
}

function MtgHeader() {
  return (
    <header style={{
      borderBottom: '1px solid #E6DBC0',
      padding: '12px 24px',
      background: '#235FAE',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{
        fontWeight: 800, fontSize: 18, color: '#F6F1E4',
        letterSpacing: '-0.01em', display: 'flex', alignItems: 'baseline', gap: 2,
      }}>
        <span>MTG</span><span style={{ color: '#D18A2E' }}>Prices</span>
      </div>
      <nav style={{ display: 'flex', gap: 14, fontSize: 13, color: '#F6F1E4' }}>
        <span>Sets</span>
        <span>Formats</span>
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
