import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { readBodyRichHtml } from '@/server/content/sanitise';
import { renderMarkdownToHtml } from '@/components/content-preview/markdown-render';
import { getFeaturedMedia } from '@/server/content/media';
import {
  TARGET_LABELS,
  type PreviewArticle,
  type PreviewTarget,
  type PreviewViewport,
} from '@/components/content-preview/types';
import { PokepricesPreview } from '@/components/content-preview/PokepricesPreview';
import { MtgPreview } from '@/components/content-preview/MtgPreview';
import { YgoPreview } from '@/components/content-preview/YgoPreview';
import { OnepiecePreview } from '@/components/content-preview/OnepiecePreview';
import { LorcanaPreview } from '@/components/content-preview/LorcanaPreview';
import { PreviewFrame } from './PreviewFrame';

// Admin-only, noindex (the parent /admin layout already applies robots
// index:false; this metadata reinforces it on the preview route in
// case the layout changes in the future). Preview NEVER mutates
// publication state — it is a pure read of the article plus a site-
// aware render.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Article preview',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

const VALID_TARGETS: PreviewTarget[] = [
  'pokeprices_external',
  'mtgprices_markdown',
  'ygo_db',
  'onepiece_db',
  'lorcana_db',
];

interface Params {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ target?: string; viewport?: string; dirty?: string }>;
}

export default async function ArticlePreviewPage({ params, searchParams }: Params) {
  const { sb } = await requireAdmin('/admin/content/articles');
  const { id } = await params;
  const sp = await searchParams;

  const { data: art } = await sb
    .from('network_articles')
    .select('id, site_id, title, slug, summary, standfirst, meta_title, meta_description, author, body, body_format, body_rich, featured_image_id, featured_image_url, og_image_url, publication_target, published_at, updated_at, network_sites(name, canonical_url)')
    .eq('id', id)
    .maybeSingle();
  if (!art) notFound();
  const a = art as unknown as {
    id: string; site_id: string; title: string; slug: string;
    summary: string | null; standfirst: string | null;
    meta_title: string | null; meta_description: string | null;
    author: string | null; body: string | null; body_format: string;
    body_rich: unknown; featured_image_id: string | null;
    featured_image_url: string | null; og_image_url: string | null;
    publication_target: PreviewTarget;
    published_at: string | null; updated_at: string;
    network_sites: { name: string; canonical_url: string };
  };

  // Target override via query param — Luke can preview how the same
  // article would look on a different site without having to re-wire
  // the publication_target. Falls back to the article's actual target.
  const target: PreviewTarget =
    VALID_TARGETS.includes(sp.target as PreviewTarget)
      ? (sp.target as PreviewTarget)
      : a.publication_target;
  const viewport: PreviewViewport = sp.viewport === 'mobile' ? 'mobile' : 'desktop';

  // Resolve body HTML. body_rich.html (Checkpoint 2) is the
  // preferred source — same sanitised representation the public
  // readers would get. For legacy markdown rows, fall back to the
  // minimal markdown renderer that mirrors each site's own.
  const richHtml = readBodyRichHtml(a.body_rich);
  const bodyHtml = richHtml ?? (a.body ? renderMarkdownToHtml(a.body) : '');

  // Featured image for the preview — prefer the explicit
  // network_article_media(role='featured') join, fall back to the
  // mirrored column on the article row.
  const featured = await getFeaturedMedia(sb, a.id, a.featured_image_id);
  const featuredImageUrl = featured?.public_url ?? a.featured_image_url ?? null;
  const featuredImageAlt = featured?.alt_text ?? null;

  // Canonical URL prediction = site's canonical_url + /insights/<slug>.
  // Every public site uses /insights for editorial, so hardcoding the
  // path is accurate; publication adapters can override later.
  const siteBase = (a.network_sites.canonical_url ?? '').replace(/\/$/, '');
  const canonicalUrlPrediction = siteBase ? `${siteBase}/insights/${a.slug}` : `/insights/${a.slug}`;

  const previewArticle: PreviewArticle = {
    id: a.id,
    title: a.title,
    slug: a.slug,
    summary: a.summary,
    standfirst: a.standfirst,
    metaTitle: a.meta_title,
    metaDescription: a.meta_description,
    author: a.author,
    publishedAt: a.published_at,
    updatedAt: a.updated_at,
    bodyHtml,
    bodyFormat: (a.body_format === 'html' ? 'html' : 'markdown') as 'html' | 'markdown',
    featuredImageUrl,
    featuredImageAlt,
    ogImageUrl: a.og_image_url,
    canonicalUrlPrediction,
    publicationTarget: target,
    siteName: TARGET_LABELS[target],
    // Dirty-state is a per-session concept we cannot observe server-
    // side. The editor passes it as ?dirty=1 when it opens the
    // preview with unsaved changes present. Preview always shows the
    // LAST SAVED version — the banner tells Luke so he does not
    // approve stale content by mistake.
    isDirtyNote: sp.dirty === '1'
      ? 'The editor has unsaved changes. This preview shows the LAST SAVED version — save first if you want these edits reflected.'
      : null,
  };

  // Pick the site-specific preview shell.
  let siteShell: React.ReactNode = null;
  switch (target) {
    case 'pokeprices_external': siteShell = <PokepricesPreview a={previewArticle} />; break;
    case 'mtgprices_markdown':  siteShell = <MtgPreview a={previewArticle} />; break;
    case 'ygo_db':              siteShell = <YgoPreview a={previewArticle} />; break;
    case 'onepiece_db':         siteShell = <OnepiecePreview a={previewArticle} />; break;
    case 'lorcana_db':          siteShell = <LorcanaPreview a={previewArticle} />; break;
  }

  return (
    <PreviewFrame
      articleId={a.id}
      target={target}
      viewport={viewport}
      seo={{
        title: a.title,
        metaTitle: a.meta_title,
        metaDescription: a.meta_description,
        slug: a.slug,
        canonicalUrlPrediction,
        featuredImageUrl,
        ogImageUrl: a.og_image_url,
        siteName: TARGET_LABELS[target],
      }}
      isDirtyNote={previewArticle.isDirtyNote}
    >
      {siteShell}
    </PreviewFrame>
  );
}
