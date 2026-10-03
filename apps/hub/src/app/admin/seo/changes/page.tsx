import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listChanges } from '@/server/changes/engine';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ site?: string; status?: string }> }

export default async function ChangesPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/seo/changes');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const sp = await searchParams;
  const siteSlug = sp.site && sp.site !== 'network' ? sp.site : null;
  const status = sp.status ?? null;
  const siteId = siteSlug ? sites.find((s) => s.slug === siteSlug)?.id ?? null : null;
  const rows = await listChanges(sb, { siteId, status, limit: 100 });

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={siteSlug ?? 'network'} pathname="/admin/seo/changes">
      <SectionHeader
        eyebrow="SEO · Changes"
        title="SEO change tracker"
        description="Record SEO-impacting changes (title, H1, meta, canonical, schema, content, internal links, template, sitemap, robots). Each change gets a before/after view. Phase 2: manual logging only. Later phases wire this to CI."
        actions={
          <Link className="status-badge status-opportunity" href="/admin/seo/changes/new">New change →</Link>
        }
      />

      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!siteSlug ? 'status-active' : 'status-not_connected'}`} href="/admin/seo/changes">Network</Link>
          {sites.map((s) => (
            <Link key={s.slug} className={`status-badge ${siteSlug === s.slug ? 'status-active' : 'status-not_connected'}`} href={`/admin/seo/changes?site=${s.slug}`}>{s.shortName}</Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel title="No changes recorded" eyebrow="Change log">
          <EmptyState title="Nothing logged yet." description="Click 'New change' above to record your first SEO change. Each change can be measured before/after once deployed." tone="muted" />
        </Panel>
      ) : (
        <Panel title={`${rows.length} change${rows.length === 1 ? '' : 's'}`} eyebrow="Change log">
          <Table
            columns={[
              { key: 'title',   header: 'Change', render: (r: typeof rows[number]) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 460 }}>
                  <Link href={`/admin/seo/changes/${r.id}`} style={{ fontWeight: 600 }}>{r.title}</Link>
                  {r.description && <span style={{ fontSize: 12 }} className="col-dim">{r.description.slice(0, 160)}</span>}
                </div>
              ) },
              { key: 'site',   header: 'Site',    render: (r) => <span className="col-dim">{sitesById.get(r.site_id)?.shortName ?? '—'}</span> },
              { key: 'type',   header: 'Type',    render: (r) => <StatusBadge state="info" label={r.change_type.replace(/_/g, ' ')} /> },
              { key: 'url',    header: 'Target',  render: (r) => r.url ? <code style={{ fontSize: 11 }}>{r.url}</code> : r.url_pattern ? <code style={{ fontSize: 11 }}>{r.url_pattern}</code> : <span className="col-dim">—</span> },
              { key: 'status', header: 'Status',  render: (r) => <StatusBadge state={r.status === 'deployed' ? 'active' : r.status === 'completed' ? 'success' : r.status === 'rolled_back' ? 'failed' : 'info'} label={r.status.replace(/_/g, ' ')} /> },
              { key: 'depl',   header: 'Deployed',render: (r) => r.deployed_at ? formatRelative(r.deployed_at) : <span className="col-dim">—</span> },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
