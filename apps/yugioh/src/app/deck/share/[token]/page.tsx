import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Footer } from '../../../../components/Footer';
import { Header } from '../../../../components/Header';
import { getUnlistedDeckByToken } from '../../../../server/deck-publishing';
import { absoluteUrl } from '../../../../lib/site-url';
import { SharedDeckRenderer } from '../../SharedDeckRenderer';
import styles from '../../SharedDeckRenderer.module.css';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ copy_error?: string }>;
}

// Unlisted route. NEVER indexable. Not in sitemaps.
export const metadata: Metadata = {
  title: 'Shared deck — YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function UnlistedDeckPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { copy_error } = await searchParams;
  const r = await getUnlistedDeckByToken(token);
  if (!r.ok) notFound();
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <SharedDeckRenderer
          deck={r.value}
          copySource={{ kind: 'unlisted', token }}
          copyError={copy_error ?? null}
          contextNote={<>Shared via unlisted link. Not indexed and not enumerable.</>}
          shareUrl={absoluteUrl(`/deck/share/${encodeURIComponent(token)}`)}
        />
      </main>
      <Footer />
    </>
  );
}
