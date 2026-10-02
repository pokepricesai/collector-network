import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState, Panel, SectionHeader, StatusBadge, Table,
} from '@/components/admin/admin-ui';

export const dynamic = 'force-dynamic';

interface ApprovalRow {
  id: string;
  title: string;
  action_type: string;
  requested_by: 'human' | 'system' | 'ai';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'executed';
  created_at: string;
  site_id: string | null;
}

export default async function ApprovalsPage() {
  const { admin, sb } = await requireAdmin('/admin/approvals');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const { data, error } = await sb
    .from('network_approvals')
    .select('id, title, action_type, requested_by, status, created_at, site_id')
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(100);

  const rows: ApprovalRow[] = (error || !data ? [] : (data as ApprovalRow[]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/approvals">
      <SectionHeader
        eyebrow="Operations"
        title="Approvals"
        description="Consequential AI, system or human-initiated actions wait here for human review before they execute. The approval gate is already enforced in the data model."
      />
      <Panel>
        <Table
          columns={[
            { key: 'title',  header: 'Title',  render: (a) => <span style={{ fontWeight: 600 }}>{a.title}</span> },
            { key: 'action', header: 'Action', render: (a) => <span className="col-dim">{a.action_type}</span> },
            { key: 'site',   header: 'Site',   render: (a) => <span className="col-dim">{a.site_id ? (sitesById.get(a.site_id)?.name ?? '—') : 'Network'}</span> },
            { key: 'by',     header: 'Requested by', render: (a) => <StatusBadge state={a.requested_by === 'ai' ? 'info' : a.requested_by === 'human' ? 'ok' : 'info'} label={a.requested_by} /> },
            { key: 'status', header: 'Status', render: (a) => <StatusBadge state={a.status} /> },
            { key: 'created', header: 'Created', render: (a) => <span className="col-dim">{new Date(a.created_at).toISOString().slice(0, 10)}</span> },
          ]}
          rows={rows}
          empty={<EmptyState title="Nothing awaiting approval" description="AI and system suggestions will arrive here once Phase 1 scoring + Phase 2 drafting are enabled." tone="muted" />}
        />
      </Panel>
    </AdminShell>
  );
}
