import type { Metadata } from 'next';
import Hero from '@/components/home/Hero';
import LatestSets from '@/components/home/LatestSets';
import MoversBoard from '@/components/home/MoversBoard';
import TreatmentsBand from '@/components/home/TreatmentsBand';
import CollectorTools from '@/components/home/CollectorTools';
import { getHomepageData } from '@/server/homepage';
import { SITE_URL } from '@/lib/site-url';

// Revalidate every 15 minutes. Long enough that peaks don't hammer
// Supabase; short enough that movers stay fresh.
export const revalidate = 900;
// Homepage needs live Supabase reads. Skip static prerender at build
// time (may run without secrets); serve via ISR at runtime.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title:
    'OnePiecePrices — every printing, every treatment for the One Piece Card Game',
  description:
    'Live One Piece Card Game prices, treatments and sets. Parallels, alternate arts, manga rares and secret rares priced individually. Full set catalogue and market movers.',
  alternates: { canonical: `${SITE_URL}/` },
};

export default async function HomePage() {
  const payload = await getHomepageData();
  return (
    <>
      <Hero cardCount={payload.stats.cardCount} setCount={payload.stats.setCount} />
      <LatestSets sets={payload.latestSets} />
      <MoversBoard risers={payload.risers} fallers={payload.fallers} />
      <TreatmentsBand />
      <CollectorTools />
    </>
  );
}
