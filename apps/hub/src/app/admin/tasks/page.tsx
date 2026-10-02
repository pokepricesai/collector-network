import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState, FilterBar, Panel, SectionHeader, StatusBadge, Table,
} from '@/components/admin/admin-ui';

export const dynamic = 'force-dynamic';

interface TaskRow {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'open' | 'in_progress' | 'waiting' | 'completed' | 'dismissed';
  site_id: string | null;
  task_type: string;
  created_at: string;
}

export default async function TasksPage() {
  const { admin, sb } = await requireAdmin('/admin/tasks');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const { data, error } = await sb
    .from('network_tasks')
    .select('id, title, priority, status, site_id, task_type, created_at')
    .in('status', ['open', 'in_progress', 'waiting'])
    .order('created_at', { ascending: false })
    .limit(100);

  const rows: TaskRow[] = (error || !data ? [] : (data as TaskRow[]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/tasks">
      <SectionHeader
        eyebrow="Operations"
        title="Tasks"
        description="Central to-do model. Tasks arrive from AI opportunities, health alerts and manual entry. Priority + status drive routing."
      />
      <FilterBar>
        <span className="col-dim" style={{ fontSize: 12 }}>
          Filters land in a later pass. Rows below show every open / in-progress / waiting task.
        </span>
      </FilterBar>
      <Panel>
        <Table
          columns={[
            { key: 'title',    header: 'Task',     render: (t) => <span style={{ fontWeight: 600 }}>{t.title}</span> },
            { key: 'site',     header: 'Site',     render: (t) => <span className="col-dim">{t.site_id ? (sitesById.get(t.site_id)?.name ?? '—') : 'Network'}</span> },
            { key: 'type',     header: 'Type',     render: (t) => <span className="col-dim">{t.task_type}</span> },
            { key: 'priority', header: 'Priority', render: (t) => <StatusBadge state={t.priority} /> },
            { key: 'status',   header: 'Status',   render: (t) => <StatusBadge state={t.status} /> },
            { key: 'created',  header: 'Created',  render: (t) => <span className="col-dim">{new Date(t.created_at).toISOString().slice(0, 10)}</span> },
          ]}
          rows={rows}
          empty={<EmptyState title="No open tasks" description="Tasks will arrive automatically once Phase 1 ingestion and the SEO opportunity scorer are live." tone="muted" />}
        />
      </Panel>
    </AdminShell>
  );
}
