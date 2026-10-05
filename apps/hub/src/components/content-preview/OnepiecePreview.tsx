import type { PreviewArticle } from './types';

// Mirrors apps/onepiece/src/app/insights/[slug]/page.tsx (network
// article path). The real OP site renders in its own CSS token tree
// (var(--text), var(--text-muted) etc.) — those are inlined here as
// hex so the preview renders outside the OP app without pulling in
// its global stylesheet.

export function OnepiecePreview({ a }: { a: PreviewArticle }) {
  return (
    <div style={{
      background: '#FDFBF7',
      color: '#141928',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      minHeight: '100vh',
    }}>
      <OpHeader />
      <main style={{ padding: '32px 24px 80px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <nav aria-label="Breadcrumb" style={{
            marginBottom: 12, fontSize: 13, color: '#6B7280',
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ color: '#6B7280' }}>Home</span>
            <span aria-hidden>›</span>
            <span style={{ color: '#6B7280' }}>Insights</span>
            <span aria-hidden>›</span>
            <span style={{ color: '#111827', fontWeight: 600 }}>{a.title}</span>
          </nav>

          {a.featuredImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.featuredImageUrl}
              alt={a.featuredImageAlt ?? ''}
              style={{ width: '100%', height: 'auto', maxHeight: 340, objectFit: 'cover', borderRadius: 12, marginBottom: 16 }}
            />
          )}

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
            background: '#F6F3EC', fontSize: 12, color: '#6B7280',
            border: '1px solid #E5E7EB',
          }}>
            Live prices in this article come from the daily production
            feed (Cardmarket EU) and can shift between visits. If a
            specific number matters to you, open the linked card page
            for the current value.
          </div>

          <article
            className="article-body"
            style={{ marginTop: 24, fontSize: 15, lineHeight: 1.7, color: '#141928' }}
            dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
          />

          <hr style={{ marginTop: 40, border: 'none', borderTop: '1px solid #E5E7EB' }} />
          <p style={{ marginTop: 16, color: '#6B7280', fontSize: 12, lineHeight: 1.6 }}>
            Prices are shown in EUR from the current live Cardmarket EU
            feed. OnePiecePrices never applies a hardcoded FX conversion.
            Affiliate links may appear elsewhere on the site.
          </p>
        </div>
      </main>
      <PreviewBodyStyles accentColor="#C8A24C" />
    </div>
  );
}

function OpHeader() {
  return (
    <header style={{
      borderBottom: '1px solid #E5E7EB',
      padding: '12px 24px',
      background: '#FDFBF7',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{
        fontWeight: 800, fontSize: 18, color: '#141928',
        letterSpacing: '-0.01em', display: 'flex', alignItems: 'baseline', gap: 2,
      }}>
        <span>OnePiece</span><span style={{ color: '#C8A24C' }}>Prices</span>
      </div>
      <nav style={{ display: 'flex', gap: 14, fontSize: 13, color: '#6B7280' }}>
        <span>Leaders</span>
        <span>Browse</span>
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

// Shared body styles for every site preview — scoped by the parent
// `.article-body` wrapper so hub admin CSS never leaks.
export function PreviewBodyStyles({ accentColor }: { accentColor: string }) {
  return (
    <style dangerouslySetInnerHTML={{
      __html: `
        .article-body p { margin: 0 0 14px; }
        .article-body h2 { margin: 28px 0 10px; font-size: 22px; letter-spacing: -0.01em; }
        .article-body h3 { margin: 20px 0 8px; font-size: 17px; letter-spacing: -0.005em; }
        .article-body ul, .article-body ol { margin: 0 0 16px 20px; padding: 0; }
        .article-body li { margin: 0 0 4px; }
        .article-body a { color: ${accentColor}; text-decoration: underline; }
        .article-body blockquote { margin: 16px 0; padding: 8px 14px; border-left: 3px solid ${accentColor}; color: #555; background: #FAF6EC; }
        .article-body img { max-width: 100%; height: auto; display: block; border-radius: 8px; margin: 10px 0; }
        .article-body figure { margin: 14px 0; }
        .article-body figcaption { font-size: 12px; color: #777; margin-top: 4px; text-align: center; }
        .article-body code { font-family: ui-monospace, monospace; font-size: 0.92em; background: #F5F5F0; padding: 1px 4px; border-radius: 3px; }
      `,
    }} />
  );
}
