import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';
import { readBodyRichHtml } from '@/server/content/sanitise';
import { markdownToEditorHtml } from '@/server/content/markdown-import';
import { listArticleMedia, getFeaturedMedia } from '@/server/content/media';
import { ArticleEditor } from './ArticleEditor';
import type { ArticleMediaItem } from './MediaPicker';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

interface Params { params: Promise<{ id: string }> }

export default async function ArticleDetail({ params }: Params) {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const sites = await listNetworkSites(sb);
  const { id } = await params;
  const [{ data: art }, { data: links }, { data: versions }] = await Promise.all([
    sb.from('network_articles')
      .select('id, site_id, title, slug, status, body, body_format, body_rich, standfirst, meta_title, meta_description, summary, featured_image_id, publication_target, publication_url, published_at, qc_report, network_sites(slug, name, canonical_url)')
      .eq('id', id).maybeSingle(),
    sb.from('network_article_links').select('id, target_url, anchor_text, reason, state').eq('article_id', id).order('state', { ascending: true }).limit(50),
    sb.from('network_article_versions').select('version, actor_type, change_note, created_at').eq('article_id', id).order('version', { ascending: false }).limit(20),
  ]);
  if (!art) notFound();
  const a = art as unknown as {
    id: string; site_id: string; title: string; slug: string; status: string;
    body: string; body_format: string; body_rich: unknown; standfirst: string | null;
    meta_title: string | null; meta_description: string | null;
    summary: string | null; featured_image_id: string | null;
    publication_target: string; publication_url: string | null;
    published_at: string | null;
    qc_report: {
      issues?: Array<{ code: string; severity: string; message: string }>; ran_at?: string;
      deterministic?: { issues: Array<{ code: string; severity: string; message: string }>; ran_at: string | null };
      editorial?: { issues: Array<{ code: string; severity: 'blocker' | 'warning' | 'suggestion'; category: string; message: string; location?: string; suggested_fix?: string }>; summary: string; ran_at: string; model: string; cost_usd: number; checked_against: string[] };
    } | null;
    network_sites: { slug: string; name: string; canonical_url: string };
  };

  // Prefer the sanitised rich HTML. Fall back to importing the legacy
  // markdown body ONLY when body_rich is empty, so AI-generated
  // markdown drafts open without data loss.
  const richHtml = readBodyRichHtml(a.body_rich);
  const initialHtml = richHtml ?? (a.body ? markdownToEditorHtml(a.body) : '');

  const [mediaList, featured] = await Promise.all([
    listArticleMedia(sb, a.id),
    getFeaturedMedia(sb, a.id, a.featured_image_id),
  ]);
  const mediaForEditor: ArticleMediaItem[] = mediaList.map((m) => ({
    id: m.id,
    publicUrl: m.public_url,
    fileName: m.file_name,
    mimeType: m.mime_type,
    byteSize: m.byte_size,
    width: m.width,
    height: m.height,
    altText: m.alt_text,
    caption: m.caption,
    attribution: m.attribution,
    roles: m.roles,
  }));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={a.network_sites.slug} pathname={`/admin/content/articles/${id}`}>
      <SectionHeader
        eyebrow={`Content · Article · ${a.network_sites.name}`}
        title={a.title}
        description={<span>
          <code>{a.slug}</code> · target: <code>{a.publication_target.replace(/_/g, '·')}</code> · <StatusBadge state={a.status === 'published' ? 'success' : a.status === 'approved' ? 'approved' : a.status === 'review' ? 'pending' : 'info'} label={a.status} />
          {a.publication_url && <> · <a href={a.publication_url} target="_blank" rel="noopener noreferrer">{a.publication_url}</a></>}
        </span>}
        actions={<Link className="status-badge status-not_connected" href="/admin/content/articles">← All articles</Link>}
      />

      <ArticleEditor
        article={{
          id: a.id,
          title: a.title,
          slug: a.slug,
          summary: a.summary,
          standfirst: a.standfirst,
          meta_title: a.meta_title,
          meta_description: a.meta_description,
          body: a.body,
          body_format: a.body_format,
          body_rich_html: richHtml,
          status: a.status,
          qc_report: a.qc_report,
        }}
        links={((links ?? []) as Array<{ id: string; target_url: string; anchor_text: string | null; reason: string | null; state: string }>)}
        media={mediaForEditor}
        featuredMediaId={featured?.id ?? null}
        initialHtml={initialHtml}
      />

      <Panel title="Version history" eyebrow="Snapshots">
        {((versions ?? []) as Array<{ version: number; actor_type: string; change_note: string | null; created_at: string }>).length === 0 ? (
          <span className="col-dim">No versions yet.</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
            {((versions ?? []) as Array<{ version: number; actor_type: string; change_note: string | null; created_at: string }>).map((v) => (
              <li key={v.version} style={{ marginBottom: 4 }}>
                <strong>v{v.version}</strong> · {v.actor_type} · {formatRelative(v.created_at)}
                {v.change_note && <span className="col-dim"> — {v.change_note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </AdminShell>
  );
}
