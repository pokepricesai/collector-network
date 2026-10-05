import type { PreviewArticle } from './types';
import { PreviewBodyStyles } from './OnepiecePreview';

// Mirrors the PokePrices article shell — 720px column, Figtree body
// (15px / 1.8 line-height), Outfit headings, deep blue primary.
// Hero image at the top is a signature of the PokePrices article
// template, so the preview surfaces it prominently.

export function PokepricesPreview({ a }: { a: PreviewArticle }) {
  return (
    <div style={{
      background: '#DEEDFB',
      color: '#0F2240',
      fontFamily: '"Figtree", ui-sans-serif, system-ui, -apple-system, sans-serif',
      minHeight: '100vh',
    }}>
      <PokeHeader />
      <div style={{ padding: '40px 24px 80px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ marginBottom: 10, fontSize: 13 }}>
            <span style={{ color: '#2563A8' }}>← Market Insights</span>
          </div>

          {a.featuredImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.featuredImageUrl}
              alt={a.featuredImageAlt ?? ''}
              style={{ width: '100%', maxHeight: 340, objectFit: 'cover', borderRadius: 16, marginBottom: 14 }}
            />
          ) : (
            <div style={{
              width: '100%', height: 180, borderRadius: 16, marginBottom: 14,
              background: 'linear-gradient(135deg, #2563A8 0%, #4A82C8 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#FFCB05', fontWeight: 800, letterSpacing: '0.08em', fontSize: 12,
              textTransform: 'uppercase',
            }}>No hero image set</div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '6px 0 8px', fontSize: 11 }}>
            <span style={{
              padding: '3px 8px', background: '#2563A8', color: '#FFCB05',
              borderRadius: 999, textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em',
            }}>Market</span>
            <span style={{ color: '#64789B' }}>
              {a.publishedAt ? fmt(a.publishedAt) : 'Preview'}
              {a.author ? ` · ${a.author}` : ''}
            </span>
          </div>

          <h1 style={{
            fontFamily: '"Outfit", ui-sans-serif, system-ui, sans-serif',
            margin: '0 0 14px', fontSize: 32, fontWeight: 800, lineHeight: 1.2,
            letterSpacing: '-0.01em', color: '#0F2240',
          }}>
            {a.title}
          </h1>

          {(a.standfirst || a.summary) && (
            <p style={{
              margin: '0 0 20px', fontSize: 16, lineHeight: 1.55,
              color: '#334A6E',
            }}>
              {a.standfirst ?? a.summary}
            </p>
          )}

          <article
            className="article-body"
            style={{ fontSize: 15, lineHeight: 1.8, color: '#0F2240' }}
            dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
          />

          <hr style={{ marginTop: 36, border: 'none', borderTop: '1px solid #B8D1EC' }} />
          <p style={{ marginTop: 14, color: '#64789B', fontSize: 12 }}>
            Prices in this article come from PokePrices&apos; daily feed.
            Affiliate links may appear elsewhere on the site.
          </p>
        </div>
      </div>
      <PreviewBodyStyles accentColor="#2563A8" />
      <style dangerouslySetInnerHTML={{
        __html: `
          .article-body h2 { font-family: "Outfit", ui-sans-serif, system-ui, sans-serif; font-weight: 800; font-size: 20px; margin: 30px 0 10px; }
          .article-body h3 { font-family: "Outfit", ui-sans-serif, system-ui, sans-serif; font-weight: 800; font-size: 17px; margin: 24px 0 8px; }
        `,
      }} />
    </div>
  );
}

function PokeHeader() {
  return (
    <header style={{
      padding: '12px 24px',
      background: '#2563A8',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{
        fontWeight: 800, fontSize: 18, color: '#FFCB05',
        fontFamily: '"Outfit", ui-sans-serif, system-ui, sans-serif',
        display: 'flex', alignItems: 'baseline', gap: 2,
      }}>
        <span style={{ color: '#FFFFFF' }}>Poké</span><span>Prices</span>
      </div>
      <nav style={{ display: 'flex', gap: 14, fontSize: 13, color: '#DEEDFB' }}>
        <span>Sets</span>
        <span>Prices</span>
        <span>Grading</span>
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
