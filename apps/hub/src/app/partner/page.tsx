import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, SITE_URL } from '@/lib/sites';

export const metadata: Metadata = {
  title: `Partner with ${SITE_NAME}`,
  description:
    'Reach collectors across the Collector Network specialist platforms. Sponsorship, marketplace integration, grading, data and content partnerships available.',
  alternates: { canonical: `${SITE_URL}/partner` },
};

export default function PartnerPage() {
  return (
    <section className="section">
      <div className="container" style={{ display: 'grid', gap: 36 }}>
        <div style={{ display: 'grid', gap: 14, maxWidth: 760 }}>
          <h1>Partner with {SITE_NAME}</h1>
          <p className="lede">
            Partners can reach collectors directly across several specialist
            platforms rather than buying generic display advertising. Each
            opportunity is matched to the game, surface and intent that fit.
          </p>
        </div>

        <div className="cards-2">
          <div className="card">
            <h3>Sponsorship</h3>
            <ul style={listStyle}>
              <li>Category sponsorship</li>
              <li>Homepage and site placements</li>
              <li>Targeted card and set placements</li>
              <li>Brand visibility around relevant tools</li>
            </ul>
          </div>
          <div className="card">
            <h3>Marketplace &amp; retail</h3>
            <ul style={listStyle}>
              <li>Buying links</li>
              <li>Marketplace integrations</li>
              <li>Retailer listings</li>
              <li>Commercial referrals</li>
              <li>Product and data integrations</li>
            </ul>
          </div>
          <div className="card">
            <h3>Grading</h3>
            <ul style={listStyle}>
              <li>Grading company visibility around graded card pricing</li>
              <li>Grading education and content</li>
              <li>Premium listings</li>
              <li>Data integrations</li>
            </ul>
          </div>
          <div className="card">
            <h3>Content &amp; data</h3>
            <ul style={listStyle}>
              <li>Useful sponsored editorial</li>
              <li>Market reports</li>
              <li>Pricing and data collaborations</li>
              <li>Collector research</li>
            </ul>
          </div>
        </div>

        <div className="card" style={{ display: 'grid', gap: 14 }}>
          <h3>Custom partnerships</h3>
          <p className="muted" style={{ fontSize: 15 }}>
            If a company serves trading card collectors and there is a useful
            integration we have not listed, speak to us. We would rather build
            something specific than reach for an off-the-shelf package.
          </p>
          <div>
            <Link href="/contact" className="btn btn-primary">Talk to us</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const listStyle: React.CSSProperties = {
  margin: '8px 0 0',
  paddingLeft: 20,
  lineHeight: 1.8,
  color: 'var(--text-muted)',
  fontSize: 14.5,
};
