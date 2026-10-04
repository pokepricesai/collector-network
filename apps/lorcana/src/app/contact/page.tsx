import type { Metadata } from 'next';
import { canonicalFor } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Contact LorcanaPrices',
  description: 'Get in touch with LorcanaPrices. Corrections, data feedback, partnership enquiries.',
  alternates: { canonical: canonicalFor('/contact') },
};

export default function ContactPage() {
  return (
    <article style={{ padding: '48px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 16 }}>
        <div className="label-mono" style={{ color: 'var(--accent-2)' }}>
          Contact
        </div>
        <h1 style={{ margin: 0, fontSize: 30 }}>Get in touch</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Corrections, missing sets, price-feed regressions and partnership
          enquiries, send them to{' '}
          <a href="mailto:hello@lorcanaprice.io">hello@lorcanaprice.io</a>.
        </p>
        <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          LorcanaPrices is part of the Collector Network family of TCG sites
          (Yu-Gi-Oh, Magic, Pokémon, Lorcana).
        </p>
      </div>
    </article>
  );
}
