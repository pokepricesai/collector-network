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
        description="The canonical five-site registry. Everything site-scoped in the OS joins here. Edit metadata through Settings."
      />
      <Panel>
        <Table
          columns={[
            { key: 'name',    header: 'Site',       render: (s) => <Link href={`/admin/sites/${s.slug}`}>{s.name}</Link> },
            { key: 'slug',    header: 'Slug',       render: (s) => <span className="col-dim">{s.slug}</span> },
            { key: 'canon',   header: 'Canonical',  render: (s) => <a href={s.canonicalUrl} target="_blank" rel="noopener noreferrer" className="col-dim">{s.canonicalUrl}</a> },
            { key: 'app',     header: 'App',        render: (s) => <span className="col-dim">{s.productionApp ?? '—'}</span> },
            { key: 'status',  header: 'Status',     render: (s) => <StatusBadge state={s.status} /> },
          ]}
          rows={sites.map((s) => ({ ...s, id: s.id }))}
        />
      </Panel>
    </AdminShell>
  );
}
