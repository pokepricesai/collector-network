import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, SITE_URL } from '@/lib/sites';
import {
  ArrowRight,
  IconCustom,
  IconData,
  IconGrading,
  IconRetail,
  IconSponsor,
} from '@/components/icons';

export const metadata: Metadata = {
  title: `Partner with ${SITE_NAME}`,
  description:
    'Reach collectors across the Collector Network specialist platforms. Sponsorship, marketplace integration, grading, data and content partnerships available.',
  alternates: { canonical: `${SITE_URL}/partner` },
};

const CATEGORIES = [
  {
    key: 'sponsorship',
    icon: <IconSponsor />,
    title: 'Sponsorship',
    bullets: [
      'Category sponsorship',
      'Homepage and site placements',
      'Targeted card and set placements',
      'Brand visibility around relevant tools',
    ],
  },
  {
    key: 'retail',
    icon: <IconRetail />,
    title: 'Marketplace & retail',
    bullets: [
      'Buying links',
      'Marketplace integrations',
      'Retailer listings',
      'Commercial referrals',
      'Product and data integrations',
    ],
  },
  {
    key: 'grading',
    icon: <IconGrading />,
    title: 'Grading',
    bullets: [
      'Grading company visibility around graded card pricing',
      'Grading education and content',
      'Premium listings',
      'Data integrations',
    ],
  },
  {
    key: 'data',
    icon: <IconData />,
    title: 'Content & data',
    bullets: [
      'Useful sponsored editorial',
      'Market reports',
      'Pricing and data collaborations',
      'Collector research',
    ],
  },
  {
    key: 'custom',
    icon: <IconCustom />,
    title: 'Custom partnerships',
    bullets: [
      'If a company serves trading card collectors and there is a useful integration we have not listed, speak to us. We would rather build something specific than reach for an off-the-shelf package.',
    ],
  },
] as const;

export default function PartnerPage() {
  return (
    <section className="section">
      <div className="container" style={{ display: 'grid', gap: 40 }}>
        <div style={{ display: 'grid', gap: 14, maxWidth: 780 }}>
          <span className="eyebrow">Partner</span>
          <h1>Partner with {SITE_NAME}.</h1>
          <p className="lede">
            Partners can reach collectors directly across several specialist
            platforms rather than buying generic display advertising. Each
            opportunity is matched to the game, surface and intent that fit.
          </p>
        </div>

        <div className="cards-3">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="partner-card">
              <span className="partner-icon">{c.icon}</span>
              <h3>{c.title}</h3>
              <ul>
                {c.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="partner-cta">
          <div>
            <h2>Talk to us about a partnership.</h2>
            <p>
              Tell us what you&apos;re building. If it serves collectors across
              one or more of our games, we&apos;ll shape an integration that
              fits.
            </p>
          </div>
          <Link href="/contact" className="btn btn-primary btn-lg">
            <span>Talk to us</span>
            <ArrowRight className="arrow" />
          </Link>
        </div>
      </div>
    </section>
  );
}
