import type { Metadata } from 'next';
import Link from 'next/link';
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Params {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ target?: string; viewport?: string; dirty?: string }>;
}

export default async function ArticlePreviewPage({ params, searchParams }: Params) {
  const { sb } = await requireAdmin('/admin/content/articles');
  const { id } = await params;
  const sp = await searchParams;

  // Validate id shape BEFORE touching Postgres. Supabase's PostgREST
  // throws a 400 on `eq('id', '<not-a-uuid>')` which old code was
  // treating as "null row" and silently 404ing. Surface the shape
  // issue instead.
  if (!UUID_RE.test(id)) {
    return <PreviewError title="Preview URL is malformed" details={`Article id "${id}" is not a UUID. Return to the editor and click Preview from there.`} />;
  }

  // Query the article WITHOUT an embedded resource. The previous
  // version used `.select(..., network_sites(name, canonical_url))`
  // which, under certain RLS configurations where the admin can see
  // the article row but not the site row, causes PostgREST to drop
  // the parent row entirely and return null — which was swallowed by
  // the previous `if (!art) notFound()`. Split the queries so each
  // one can be diagnosed independently.
  const { data: art, error: artErr } = await sb
    .from('network_articles')
    .select('id, site_id, title, slug, summary, standfirst, meta_title, meta_description, author, body, body_format, body_rich, featured_image_id, featured_image_url, og_image_url, publication_target, published_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (artErr) {
    return <PreviewError title="Could not load article" details={`Supabase error: ${artErr.message}. Code: ${artErr.code ?? '?'}. Article id: ${id}.`} />;
  }
  if (!art) {
    return <PreviewError title="Article not found" details={`No article with id ${id} is visible to your admin session. If you can see it in the editor, this is a bug — report the id.`} />;
  }
  const a = art as unknown as {
    id: string; site_id: string; title: string; slug: string;
    summary: string | null; standfirst: string | null;
    meta_title: string | null; meta_description: string | null;
    author: string | null; body: string | null; body_format: string;
    body_rich: unknown; featured_image_id: string | null;
    featured_image_url: string | null; og_image_url: string | null;
    publication_target: PreviewTarget;
    published_at: string | null; updated_at: string;
  };

  // Site lookup — separate query so a sites RLS or missing-row issue
  // can't mask the article load.
  const { data: siteRow } = await sb
    .from('network_sites')
    .select('name, canonical_url')
    .eq('id', a.site_id)
    .maybeSingle();
  const site = (siteRow ?? null) as { name: string | null; canonical_url: string | null } | null;

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
  // path is accurate; publication adapters can override later. Falls
  // back to a path-only URL if the site row couldn't be read.
  const siteBase = (site?.canonical_url ?? '').replace(/\/$/, '');
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

// Minimal in-shell error page so Luke sees a diagnostic page instead
// of an opaque 404 when the preview query fails. Styled to match the
// chrome used by the real preview so he isn't dropped onto an
// unstyled Next error screen.
function PreviewError({ title, details }: { title: string; details: string }) {
  return (
    <div style={{ minHeight: '100vh', background: '#1A1A1A', color: '#F2F2F2', padding: 24, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '40px auto', padding: 20, background: '#272727', borderRadius: 6 }}>
        <h1 style={{ fontSize: 18, margin: '0 0 10px' }}>Preview: {title}</h1>
        <p style={{ fontSize: 13, color: '#CCC', lineHeight: 1.5, margin: '0 0 14px', wordBreak: 'break-word' }}>
          {details}
        </p>
        <Link href="/admin/content/articles" style={{ color: '#88B4FF', fontSize: 12 }}>← Back to articles</Link>
      </div>
    </div>
  );
}
