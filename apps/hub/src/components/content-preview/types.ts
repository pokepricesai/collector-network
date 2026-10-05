// Shape passed from the server preview route to each site-specific
// preview component. Kept flat and self-contained so the preview
// components stay pure UI — all data resolution (body_rich → html
// fallback, featured media join, canonical URL prediction) happens
// in the route.

export type PreviewTarget =
  | 'pokeprices_external'
  | 'mtgprices_markdown'
  | 'ygo_db'
  | 'onepiece_db'
  | 'lorcana_db';

export type PreviewViewport = 'desktop' | 'mobile';

export interface PreviewArticle {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  standfirst: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  author: string | null;
  publishedAt: string | null;
  updatedAt: string;
  bodyHtml: string;             // sanitised, ready for dangerouslySetInnerHTML
  bodyFormat: 'html' | 'markdown';
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  ogImageUrl: string | null;
  canonicalUrlPrediction: string;
  publicationTarget: PreviewTarget;
  siteName: string;
  isDirtyNote: string | null;   // non-null when the editor had unsaved changes
}

export const VIEWPORT_PX: Record<PreviewViewport, number> = {
  desktop: 1200,
  mobile: 390,
};

export const TARGET_LABELS: Record<PreviewTarget, string> = {
  pokeprices_external: 'PokePrices',
  mtgprices_markdown: 'MTGPrices',
  ygo_db: 'YGOPrices',
  onepiece_db: 'OnePiecePrices',
  lorcana_db: 'LorcanaPrices',
};
