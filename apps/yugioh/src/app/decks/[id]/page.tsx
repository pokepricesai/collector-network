import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { getDeckDetail } from '../../../server/decks';
import { getOwnedDeckSharing } from '../../../server/deck-publishing';
import { siteUrl } from '../../../lib/site-url';
import { DeckBuilder } from './DeckBuilder';
import styles from '../Decks.module.css';

interface Props {
  params: Promise<{ id: string }>;
}

// Private deck route. noindex, follow — public deck sharing is a
// later slice. Not in sitemaps.
export const metadata: Metadata = {
  title: 'Deck builder - YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function DeckDetailPage({ params }: Props) {
  const { id } = await params;
  await requireUser(`/decks/${id}`);
  const result = await getDeckDetail(id);
  // Guess-a-UUID protection: `requireUser` establishes the session,
  // then RLS + our explicit user-id check in getDeckDetail turn a
  // stranger's deck into "not found" rather than an authorisation
  // error — no oracle either way.
  if (!result.ok) {
    if (result.reason === 'table-missing') {
      return (
        <>
          <Header compactSearch />
          <main className={styles.page}>
            <div className={styles.pendingNotice}>
              Deck storage is being provisioned. As soon as the migration
              lands you can start building.
            </div>
          </main>
          <Footer />
        </>
      );
    }
    if (result.error === 'Deck not found') notFound();
    return (
      <>
        <Header compactSearch />
        <main className={styles.page}>
          <div className={styles.error}>Could not load this deck: {result.error}.</div>
        </main>
        <Footer />
      </>
    );
  }
  const sharingRes = await getOwnedDeckSharing(id);
  const sharing = sharingRes.ok ? sharingRes.value : null;
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <DeckBuilder
          detail={result.value}
          sharing={
            sharing
              ? {
                  visibility: sharing.visibility,
                  public_slug: sharing.public_slug,
                  share_token: sharing.share_token,
                  siteOrigin: siteUrl(),
                }
              : null
          }
        />
      </main>
      <Footer />
    </>
  );
}
