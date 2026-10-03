import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ status?: string; site?: string }> }
interface ArticleRow {
  id: string; site_id: string; title: string; slug: string; status: string;
  content_type: string; publication_target: string; publication_url: string | null;
  updated_at: string; published_at: string | null; primary_query: string | null;
}

export default async function ArticlesPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const status = sp.status ?? null;
  const siteSlug = sp.site && sp.site !== 'network' ? sp.site : null;
  const siteId = siteSlug ? sites.find((s) => s.slug === siteSlug)?.id ?? null : null;

  let q = sb.from('network_articles')
    .select('id, site_id, title, slug, status, content_type, publication_target, publication_url, updated_at, published_at, primary_query')
    .order('updated_at', { ascending: false }).limit(200);
  if (siteId) q = q.eq('site_id', siteId);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  const rows = (data ?? []) as ArticleRow[];
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={siteSlug ?? 'network'} pathname="/admin/content/articles">
      <SectionHeader
        eyebrow="Content · Articles"
        title="Articles"
        description="Every article in the pipeline. Click into an article to edit, generate draft (AI), run QC, approve, and publish."
      />
      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!siteSlug ? 'status-active' : 'status-not_connected'}`} href="/admin/content/articles">Network</Link>
          {sites.map((s) => (
            <Link key={s.slug} className={`status-badge ${siteSlug === s.slug ? 'status-active' : 'status-not_connected'}`} href={`/admin/content/articles?site=${s.slug}`}>{s.shortName}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <Link className={`status-badge ${!status ? 'status-active' : 'status-not_connected'}`} href={`/admin/content/articles${siteSlug ? `?site=${siteSlug}` : ''}`}>All</Link>
          {(['draft', 'review', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'archived'] as const).map((s) => (
            <Link key={s} className={`status-badge ${status === s ? 'status-active' : 'status-not_connected'}`} href={`/admin/content/articles?${siteSlug ? `site=${siteSlug}&` : ''}status=${s}`}>{s}</Link>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <Panel title="No articles" eyebrow="Pipeline"><EmptyState title="Nothing yet." description="Create one by approving a brief and clicking 'Create article from brief'." tone="muted" /></Panel>
      ) : (
        <Panel title={`${rows.length} article${rows.length === 1 ? '' : 's'}`} eyebrow="Pipeline">
          <Table<ArticleRow>
            columns={[
              { key: 't', header: 'Title', render: (a) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 500 }}>
                  <Link href={`/admin/content/articles/${a.id}`} style={{ fontWeight: 600 }}>{a.title}</Link>
                  <span className="col-dim" style={{ fontSize: 11 }}><code>{a.slug}</code> · {a.content_type.replace(/_/g, ' ')}{a.primary_query ? ` · "${a.primary_query}"` : ''}</span>
                </div>
              ) },
              { key: 'site', header: 'Site', render: (a) => sitesById.get(a.site_id)?.shortName ?? '' },
              { key: 'status', header: 'Status', render: (a) => <StatusBadge state={a.status === 'published' ? 'success' : a.status === 'approved' ? 'approved' : a.status === 'review' ? 'pending' : 'info'} label={a.status} /> },
              { key: 'target', header: 'Target', render: (a) => <code style={{ fontSize: 11 }}>{a.publication_target.replace(/_/g, '·')}</code> },
              { key: 'updated', header: 'Updated', render: (a) => formatRelative(a.updated_at) },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
