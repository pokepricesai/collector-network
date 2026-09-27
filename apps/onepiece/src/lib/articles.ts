// Insight article registry. Each entry is a URL slug + display
// metadata; the actual body is a React component rendered by
// /insights/[slug]/page.tsx. Kept separate from the components so
// the index page can enumerate articles without importing every body.

export interface OpArticleMeta {
  slug: string;
  title: string;
  description: string;
  publishedIso: string;
  updatedIso: string;
  readingMinutes: number;
  category: string;
  excerpt: string;
}

export const OP_ARTICLES: OpArticleMeta[] = [
  {
    slug: 'most-valuable-one-piece-cards',
    title: 'The most valuable One Piece Card Game cards',
    description:
      'A collector-focused tour of the highest-priced One Piece Card Game printings today: which Leaders, chase treatments and sets dominate the top of the market.',
    publishedIso: '2026-09-27',
    updatedIso: '2026-09-27',
    readingMinutes: 6,
    category: 'Market',
    excerpt:
      'Which cards top the One Piece market today, and why the price gap between a base Leader and its Parallel is so wide.',
  },
  {
    slug: 'rarities-and-parallels-explained',
    title: 'One Piece Card Game rarities and Parallel cards explained',
    description:
      'A precise guide to every One Piece Card Game rarity code, the Parallel and Reprint suffix convention, and why "Alt Art" and "Manga Rare" are not the same as a Parallel.',
    publishedIso: '2026-09-27',
    updatedIso: '2026-09-27',
    readingMinutes: 7,
    category: 'Reference',
    excerpt:
      'From Common to Secret Rare to Treasure Rare — and why a _p1 suffix is not the same as an Alt Art or Manga Rare.',
  },
  {
    slug: 'collecting-guide-sets-leaders-parallels-prices',
    title: 'One Piece Card Game collecting guide: sets, Leaders, Parallels and prices',
    description:
      'A collector-oriented walkthrough of the One Piece Card Game: how sets are labelled, how Leaders anchor a collection, why chase Parallels matter, and how prices are tracked.',
    publishedIso: '2026-09-27',
    updatedIso: '2026-09-27',
    readingMinutes: 8,
    category: 'Guide',
    excerpt:
      'Where to start collecting, how to read a set code, and what to spend on first if you want a chase-worthy stack.',
  },
];

export function findArticle(slug: string): OpArticleMeta | undefined {
  return OP_ARTICLES.find((a) => a.slug === slug);
}
