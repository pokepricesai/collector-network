import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isLcInk, LC_INK_LABEL } from '@/lib/lorcana/ink';
import { canonicalFor } from '@/lib/seo';

// V1 ink landing pages. Static content today; the "cards in this ink"
// grid arrives once the gamedata.ink index is fully populated at ingest
// time and we can filter cheaply.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isLcInk(slug)) return { title: 'Colour not found' };
  const label = LC_INK_LABEL[slug];
  return {
    title: `${label} Lorcana cards — Leaders, chase treatments and top movers`,
    description: `Every ${label} Disney Lorcana card, grouped by Leaders and chase treatments.`,
    alternates: { canonical: canonicalFor(`/inks/${slug}`) },
  };
}

export default async function InkDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isLcInk(slug)) notFound();
  const label = LC_INK_LABEL[slug];

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
            href="/inks"
            style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            Inks
          </Link>
          <span aria-hidden>›</span>
          <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
            {label}
          </span>
        </nav>

        <header className="lc-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <span className={`chip chip-ink chip-ink--${slug}`}>{label}</span>
            <h1 style={{ margin: '10px 0 6px', fontSize: 30 }}>
              {label} ink
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
              Every {label.toLowerCase()} card, top-value Enchanted and
              Iconic overprints and the latest {label.toLowerCase()} set
              releases — all on one page. The full grid arrives with the
              next data update.
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
          Ink-scoped card grid coming soon. Meanwhile,{' '}
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
