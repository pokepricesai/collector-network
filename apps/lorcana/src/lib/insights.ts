// Article registry for the /insights section. Hand-written, grounded
// in real Lorcana catalogue vocabulary. See docs/lorcana/data-audit.md
// for the schema/data these lean on.

export interface ArticleMeta {
  slug: string;
  title: string;
  description: string;
  metaTitle: string;
  metaDescription: string;
  publishedAt: string;   // ISO
  updatedAt: string;
  tags: string[];
}

export const LORCANA_ARTICLES: ArticleMeta[] = [
  {
    slug: 'most-valuable-disney-lorcana-cards',
    title: 'The Most Valuable Disney Lorcana Cards',
    description:
      'A live look at the highest-priced Disney Lorcana cards on the secondary market — Enchanted, Iconic and Epic overprints, plus which promo prints command the biggest premiums.',
    metaTitle:
      'The Most Valuable Disney Lorcana Cards · LorcanaPrices',
    metaDescription:
      'Live ranking of the most expensive Disney Lorcana cards. Updated daily from Cardmarket EU. Enchanted overprints, Iconic parallels, chase Legendary variants and the promo prints commanding four-figure prices.',
    publishedAt: '2026-09-27',
    updatedAt: '2026-09-27',
    tags: ['market', 'chase', 'enchanted'],
  },
  {
    slug: 'lorcana-rarities-explained',
    title:
      'Disney Lorcana Rarities Explained: Enchanted, Iconic, Epic, Legendary and More',
    description:
      'What every Lorcana rarity actually means — from base Common to the 1:432 Enchanted overprint. How rarity, treatment and finish combine to make a printing.',
    metaTitle:
      'Disney Lorcana Rarities Explained · LorcanaPrices',
    metaDescription:
      'A collector-focused guide to every Disney Lorcana rarity: Common, Uncommon, Rare, Super Rare, Legendary, Epic, Iconic, Enchanted and Promo. How they combine with finish (foil vs nonfoil) to define a printing, and which cards actually appear at each tier.',
    publishedAt: '2026-09-27',
    updatedAt: '2026-09-27',
    tags: ['reference', 'rarity', 'beginner'],
  },
  {
    slug: 'lorcana-collecting-guide',
    title:
      'Disney Lorcana Card Collecting Guide: Sets, Foils, Enchanted Cards and Prices',
    description:
      'How to build a Lorcana collection without getting lost. Set families, the difference between finish and treatment, Enchanted chase odds, and how to read live market prices.',
    metaTitle:
      'Disney Lorcana Collecting Guide · LorcanaPrices',
    metaDescription:
      'A practical beginner-to-collector guide to Disney Lorcana. How the set families (Chapter releases, promo sets, D23) fit together, the difference between foil finish and Enchanted treatment, how to track live retail prices and what to look for when starting a collection.',
    publishedAt: '2026-09-27',
    updatedAt: '2026-09-27',
    tags: ['guide', 'collecting', 'beginner'],
  },
];

export function findArticle(slug: string): ArticleMeta | null {
  return LORCANA_ARTICLES.find((a) => a.slug === slug) ?? null;
}
