import type { Metadata } from 'next';
import { canonicalFor } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'LorcanaPrice terms of use.',
  alternates: { canonical: canonicalFor('/terms') },
};

export default function TermsPage() {
  return (
    <article style={{ padding: '48px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 16 }}>
        <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
          Terms
        </div>
        <h1 style={{ margin: 0, fontSize: 30 }}>Terms of use</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          LorcanaPrice is provided informationally. Prices are aggregated
          from third-party marketplaces and can be stale. Nothing on this
          site is financial or investment advice. Disney Lorcana and Lorcana
          Card Game are trademarks of their respective owners; LorcanaPrice
          is unofficial and unaffiliated.
        </p>
      </div>
    </article>
  );
}
