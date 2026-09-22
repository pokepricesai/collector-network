import type { Metadata } from 'next';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import {
  DataNotes,
  GradedHighlights,
  Hero,
  HomepageShell,
  IconicCards,
  LatestSets,
  MostValuable,
  RarityDiscovery,
} from '../components/homepage/Sections';
import { getYugiohHomepageData } from '../server/homepage';

// The homepage renders live from production Supabase via the Slice 3
// read layer + Slice 4 design system. Each section's data is fetched
// independently and failures degrade to a placeholder — the page never
// crashes because one query failed.

export const metadata: Metadata = {
  title:
    'Duelist Prices — Yu-Gi-Oh! collector catalogue · printings, editions, graded values',
  description:
    'Find the exact Yu-Gi-Oh! card you own. Compare every printing, edition, and rarity. Raw prices and graded values side by side.',
  alternates: { canonical: 'https://duelistprices.example/' },
};

// Revalidate the homepage every 15 minutes. Long enough that traffic
// spikes don't hammer Supabase; short enough that freshness stays
// current for movers/latest-sets.
export const revalidate = 900;

export default async function HomePage() {
  const payload = await getYugiohHomepageData();
  const siteUrl = 'https://duelistprices.example';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Duelist Prices',
    url: siteUrl,
    description:
      'Yu-Gi-Oh! collector catalogue — printings, editions, rarities and graded values.',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  } as const;
  return (
    <>
      <Header compactSearch />
      <script
        type="application/ld+json"
        // Safe: this is a plain literal object with no user input; JSON.stringify
        // is enough. React 19 escapes < and > by default in text nodes.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HomepageShell>
        <Hero />
        <IconicCards families={payload.iconicCards} />
        <MostValuable items={payload.mostValuable} />
        <LatestSets sets={payload.latestSets} />
        <GradedHighlights items={payload.gradedHighlights} />
        <RarityDiscovery entries={payload.rarityDiscovery} />
        <DataNotes payload={payload} />
      </HomepageShell>
      <Footer />
    </>
  );
}
