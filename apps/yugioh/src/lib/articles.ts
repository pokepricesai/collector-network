// Insight article registry. Metadata only; each article's body is a
// React component in the /insights/[slug] page.

export interface YgoArticleMeta {
  slug: string;
  title: string;
  description: string;
  publishedIso: string;
  updatedIso: string;
  readingMinutes: number;
  category: string;
  excerpt: string;
}

export const YGO_ARTICLES: YgoArticleMeta[] = [
  {
    slug: 'most-valuable-yugioh-cards',
    title: 'The most valuable Yu-Gi-Oh! cards',
    description:
      'A collector-focused tour of the highest-priced Yu-Gi-Oh! printings today: which sets, rarities and eras dominate the top of the market, with live pricing from the same feed the rest of the site uses.',
    publishedIso: '2026-09-28',
    updatedIso: '2026-09-28',
    readingMinutes: 6,
    category: 'Market',
    excerpt:
      'Which Yu-Gi-Oh! printings top the live market today, and why LOB Ultra Rares and Prismatic Secret Rares dominate the ranking.',
  },
  {
    slug: 'yugioh-rarities-explained',
    title:
      'Yu-Gi-Oh! card rarities explained: Secret Rare, Ultimate Rare, Ghost Rare, Starlight Rare and more',
    description:
      'A precise guide to every Yu-Gi-Oh! rarity you will encounter. From Common through Prismatic Secret Rare. And why rarity is not the same as edition or treatment.',
    publishedIso: '2026-09-28',
    updatedIso: '2026-09-28',
    readingMinutes: 8,
    category: 'Reference',
    excerpt:
      'From Common to Prismatic Secret Rare, plus why edition, treatment and rarity are three separate axes on every printing.',
  },
  {
    slug: 'yugioh-collecting-guide-sets-editions-rarities-prices',
    title: 'Yu-Gi-Oh! collecting guide: sets, editions, rarities and prices',
    description:
      'A collector-oriented walkthrough of the Yu-Gi-Oh! Trading Card Game: how sets are structured, how to read a printing, why 1st Edition matters, and how to start a serious collection.',
    publishedIso: '2026-09-28',
    updatedIso: '2026-09-28',
    readingMinutes: 9,
    category: 'Guide',
    excerpt:
      'How to read a Yu-Gi-Oh! printing (set × rarity × edition), where to start collecting, and what a chase card really means.',
  },
];

export function findYgoArticle(slug: string): YgoArticleMeta | undefined {
  return YGO_ARTICLES.find((a) => a.slug === slug);
}
