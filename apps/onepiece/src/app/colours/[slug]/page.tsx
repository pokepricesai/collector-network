import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isOpColour, OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import { canonicalFor } from '@/lib/seo';

// V1 colour landing pages. Static content today; the "cards in this
// colour" grid arrives once the gamedata.colours index is fully
// populated at ingest time and we can filter cheaply.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isOpColour(slug)) return { title: 'Colour not found' };
  const label = OP_COLOUR_LABEL[slug];
  return {
    title: `${label} One Piece cards — Leaders, chase treatments and top movers`,
    description: `Every ${label} One Piece Card Game card, grouped by Leaders and chase treatments.`,
    alternates: { canonical: canonicalFor(`/colours/${slug}`) },
  };
}

export default async function ColourDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isOpColour(slug)) notFound();
  const label = OP_COLOUR_LABEL[slug];

  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <nav
          aria-label="Breadcrumb"
          style={{
            marginBottom: 16,
            fontSize: 13,
            color: 'var(--text-muted)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
            Home
          </Link>
          <span aria-hidden>›</span>
          <Link
            href="/colours"
            style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            Colours
          </Link>
          <span aria-hidden>›</span>
          <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
            {label}
          </span>
        </nav>

        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <span className={`chip chip-${slug}`}>{label}</span>
            <h1 style={{ margin: '10px 0 6px', fontSize: 30 }}>
              {label} cards
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
              Colour-scoped card browse. Once the ingest pipeline finishes
              populating the colour index on every card, this page will list
              every {label.toLowerCase()} Leader, top chase treatments, and the
              latest {label.toLowerCase()} set releases.
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
          Colour-scoped card grid arrives with the next data slice. Meanwhile,{' '}
          <Link href="/cards/search" style={{ fontWeight: 700 }}>
            search for a card
          </Link>{' '}
          or{' '}
          <Link href="/browse" style={{ fontWeight: 700 }}>
            browse by set
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
