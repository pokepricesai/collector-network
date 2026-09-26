import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';

// V1 insights hub. Editorial articles land in the next slice. For
// now we render a placeholder with the intended cadence so the
// sitemap-eligible URL exists and the nav has somewhere to go.

export const metadata: Metadata = {
  title: 'One Piece market insights — set analysis, treatment premiums, launch trackers',
  description:
    'Editorial analysis of the One Piece Card Game market. Set-by-set treatment premiums, chase-card tracking and release cadence.',
  alternates: { canonical: canonicalFor('/insights') },
};

export default function InsightsIndex() {
  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Insights
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Market analysis, set-by-set
            </h1>
            <p
              style={{
                margin: 0,
                color: 'var(--text-muted)',
                fontSize: 15,
                lineHeight: 1.55,
                maxWidth: 640,
              }}
            >
              Set-by-set breakdowns of treatment premiums, chase-card tracking
              across languages, and launch-window analysis. First articles are
              on the way.
            </p>
          </div>
        </header>

        <div
          style={{
            padding: '32px 24px',
            background: 'var(--surface)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 16,
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.55,
          }}
        >
          Editorial articles are on their way. In the meantime,{' '}
          <Link href="/market" style={{ fontWeight: 700 }}>
            watch the movers board
          </Link>{' '}
          for the freshest signal.
        </div>
      </div>
    </div>
  );
}
