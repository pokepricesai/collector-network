import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState, Panel, SectionHeader, StatusBadge, Table,
} from '@/components/admin/admin-ui';

export const dynamic = 'force-dynamic';

interface AlertRow {
  id: string;
  level: 'critical' | 'warning' | 'opportunity' | 'info';
  category: string;
  title: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'suppressed';
  site_id: string | null;
  first_detected_at: string;
}

export default async function AlertsPage() {
  const { admin, sb } = await requireAdmin('/admin/alerts');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const { data, error } = await sb
    .from('network_alerts')
    .select('id, level, category, title, status, site_id, first_detected_at')
    .neq('status', 'resolved')
    .order('first_detected_at', { ascending: false })
    .limit(100);

  const rows: AlertRow[] = (error || !data ? [] : (data as AlertRow[]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/alerts">
      <SectionHeader
        eyebrow="Operations"
        title="Alerts"
        description="Automatically detected signals across the network. Later phases wire the detectors; the model is ready now."
      />
      <Panel>
        <Table
          columns={[
            { key: 'title',    header: 'Alert',    render: (a) => <span style={{ fontWeight: 600 }}>{a.title}</span> },
            { key: 'site',     header: 'Site',     render: (a) => <span className="col-dim">{a.site_id ? (sitesById.get(a.site_id)?.name ?? '—') : 'Network'}</span> },
            { key: 'category', header: 'Category', render: (a) => <span className="col-dim">{a.category}</span> },
            { key: 'level',    header: 'Level',    render: (a) => <StatusBadge state={a.level} /> },
            { key: 'status',   header: 'Status',   render: (a) => <StatusBadge state={a.status} /> },
            { key: 'first',    header: 'First seen', render: (a) => <span className="col-dim">{new Date(a.first_detected_at).toISOString().slice(0, 10)}</span> },
          ]}
          rows={rows}
          empty={<EmptyState title="No open alerts" description="Detectors arrive with each later phase (SEO drop, cron failure, revenue anomaly, etc.)." tone="muted" />}
        />
      </Panel>
    </AdminShell>
  );
}
