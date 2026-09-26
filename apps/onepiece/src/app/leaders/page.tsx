import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';

// V1 Leaders directory. Static explainer today. The full leader grid
// wires up once the gamedata.type='leader' filter is queryable at
// scale (needs an ingest-side index on tcg_cards.gamedata->>type).

export const metadata: Metadata = {
  title: 'One Piece Leaders — every Leader card, sorted by colour and set',
  description:
    'Directory of every One Piece Card Game Leader. Each Leader defines a deck; browse by colour pairing, set and value.',
  alternates: { canonical: canonicalFor('/leaders') },
};

export default function LeadersPage() {
  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Leaders
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Every Leader card
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
              Leaders anchor deck construction and headline every printing.
              Browse by colour pairing to discover what a colour actually plays
              like at the deck level. Chase treatments (parallel, secret rare,
              treasure rare) are always priced separately from the standard
              Leader.
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
          The Leader directory is coming soon — every Leader listed with top
          price, chase treatments and colour pairing at a glance. Meanwhile,{' '}
          <Link href="/browse" style={{ fontWeight: 700 }}>
            browse by set
          </Link>{' '}
          or{' '}
          <Link href="/cards/search" style={{ fontWeight: 700 }}>
            search by Leader name
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
