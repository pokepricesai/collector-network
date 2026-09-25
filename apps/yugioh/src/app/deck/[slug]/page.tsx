import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import {
  getPublicDeckBySlug,
  resolvePublicSlugRequest,
} from '../../../server/deck-publishing';
import { absoluteUrl } from '../../../lib/site-url';
import { SharedDeckRenderer } from '../SharedDeckRenderer';
import styles from '../SharedDeckRenderer.module.css';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ copy_error?: string }>;
}

// Public page. Indexable — this is the SEO surface.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await getPublicDeckBySlug(slug);
  if (!r.ok) {
    return {
      title: 'Deck not found — YGOPrices',
      robots: { index: false, follow: true },
    };
  }
  const d = r.value;
  const canonical = absoluteUrl(`/deck/${encodeURIComponent(d.publicSlug ?? slug)}`);
  const mainCount = d.legality.counts.main;
  const extraCount = d.legality.counts.extra;
  const sideCount = d.legality.counts.side;
  const description = [
    `${mainCount}-card Main / ${extraCount}-card Extra / ${sideCount}-card Side Yu-Gi-Oh deck.`,
    d.legality.state === 'legal'
      ? 'Currently legal by TCG F&L.'
      : d.legality.state === 'illegal'
      ? 'Currently illegal by TCG F&L.'
      : 'Deck is currently incomplete.',
    d.totalValueUsd > 0
      ? `Estimated build value $${d.totalValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD.`
      : '',
    d.description ? d.description.slice(0, 240) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title: `${d.name} Yu-Gi-Oh Deck List | YGOPrices`,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${d.name} — Yu-Gi-Oh Deck List`,
      description,
      url: canonical,
      type: 'article',
    },
  };
}

export const dynamic = 'force-dynamic';

export default async function PublicDeckPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { copy_error } = await searchParams;
  // Rename-tolerant lookup: if the URL contains a stale prefix but
  // its 8-char suffix belongs to a currently-public deck, 308 to
  // the canonical slug. Unlisted/private decks can never match here
  // because resolvePublicSlugRequest filters on visibility='public'.
  const resolution = await resolvePublicSlugRequest(slug);
  if (resolution.kind === 'not-found') notFound();
  if (resolution.kind === 'redirect') {
    permanentRedirect(`/deck/${encodeURIComponent(resolution.toSlug)}`);
  }
  const r = await getPublicDeckBySlug(slug);
  if (!r.ok) notFound();
  const canonical = absoluteUrl(`/deck/${encodeURIComponent(r.value.publicSlug ?? slug)}`);
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <SharedDeckRenderer
          deck={r.value}
          copySource={{ kind: 'public', slug: r.value.publicSlug ?? slug }}
          copyError={copy_error ?? null}
          publicUrl={canonical}
        />
      </main>
      <Footer />
    </>
  );
}
