import type { Metadata } from 'next';
import { canonicalFor } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'OnePiecePrices privacy policy.',
  alternates: { canonical: canonicalFor('/privacy') },
};

export default function PrivacyPage() {
  return (
    <article style={{ padding: '48px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 16 }}>
        <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
          Privacy
        </div>
        <h1 style={{ margin: 0, fontSize: 30 }}>Privacy policy</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          OnePiecePrices collects the minimum data required to serve pages.
          Anonymous page-view metrics are recorded via Vercel Web Analytics.
          We do not sell personal data. If we ever add authenticated
          collection tracking, an authenticated section of the site will
          describe the data collected at that point.
        </p>
        <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Affiliate links to marketplaces (e.g. eBay) place third-party
          cookies on the destination site, not on onepieceprices.io.
        </p>
      </div>
    </article>
  );
}
