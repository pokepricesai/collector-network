import Link from 'next/link';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';

export const dynamic = 'force-dynamic';

export default async function SitesIndexPage() {
  const { admin, sb } = await requireAdmin('/admin/sites');
  const sites = await listNetworkSites(sb);
  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/sites">
      <SectionHeader
        eyebrow="Sites"
        title="Network sites"
        description="The canonical five-site registry. Open the site admin workspace or jump to the live site."
      />
      <Panel>
        <Table
          columns={[
            { key: 'name', header: 'Site', render: (s) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Link href={`/admin/sites/${s.slug}`} style={{ fontWeight: 600, textDecoration: 'none', color: 'inherit' }}>{s.name}</Link>
                <span className="col-dim" style={{ fontSize: 11 }}>{s.canonicalUrl.replace(/^https?:\/\//, '')}</span>
              </div>
            ) },
            { key: 'status', header: 'Lifecycle', render: (s) => <StatusBadge state={s.status} /> },
            { key: 'actions', header: '', render: (s) => (
              <div style={{ display: 'inline-flex', gap: 6 }}>
                <Link href={`/admin/sites/${s.slug}`} className="ui-btn ui-btn--secondary ui-btn--sm">Workspace</Link>
                <a href={s.canonicalUrl} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--secondary ui-btn--sm">Open live site ↗</a>
              </div>
            ) },
          ]}
          rows={sites.map((s) => ({ ...s, id: s.id }))}
        />
        <details style={{ marginTop: 12, fontSize: 11, color: 'var(--admin-text-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>Technical identifiers</summary>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 4 }}>
            {sites.map((s) => (
              <div key={`t-${s.id}`} style={{ display: 'contents' }}>
                <code>{s.slug}</code>
                <span className="col-dim">{s.productionApp ?? '—'}</span>
              </div>
            ))}
          </div>
        </details>
      </Panel>
    </AdminShell>
  );
}
