import type { Metadata } from 'next';
import Hero from '@/components/home/Hero';
import LatestSets from '@/components/home/LatestSets';
import MostValuable from '@/components/home/MostValuable';
import EnchantedSpotlight from '@/components/home/EnchantedSpotlight';
import InksExplorer from '@/components/home/InksExplorer';
import { getHomepageData } from '@/server/homepage';
import { SITE_URL } from '@/lib/site-url';

// Revalidate every 15 minutes. Long enough that peaks don't hammer
// Supabase; short enough that new set-value data stays fresh.
export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title:
    'LorcanaPrices — every printing, every Enchanted for Disney Lorcana',
  description:
    'Live Disney Lorcana card prices, printings and chase treatments. Enchanted, Iconic, Epic, Legendary and Promo cards priced individually across foil and nonfoil. Full set catalogue and market movers.',
  alternates: { canonical: `${SITE_URL}/` },
};

export default async function HomePage() {
  const payload = await getHomepageData();
  return (
    <>
      <Hero
        cardCount={payload.stats.cardCount}
        setCount={payload.stats.setCount}
        enchantedCount={payload.stats.enchantedCount}
      />
      <EnchantedSpotlight
        tiles={payload.enchantedSpotlight}
        iconic={payload.iconicSpotlight}
      />
      <MostValuable tiles={payload.mostValuable} />
      <LatestSets sets={payload.latestSets} />
      <InksExplorer />
    </>
  );
}
