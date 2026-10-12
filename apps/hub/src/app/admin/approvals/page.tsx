import Link from 'next/link';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { siteDisplayName } from '@/lib/display-names';

export const dynamic = 'force-dynamic';

interface ApprovalRow {
  id: string;
  title: string;
  action_type: string;
  requested_by: 'human' | 'system' | 'ai';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'executed';
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  site_id: string | null;
}

interface PageProps {
  searchParams?: Promise<{ view?: string }>;
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/approvals');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const sp = (await searchParams) ?? {};
  const view = sp.view === 'history' ? 'history' : 'pending';

  const [pendingRes, historyRes] = await Promise.all([
    sb.from('network_approvals')
      .select('id, title, action_type, requested_by, status, created_at, reviewed_at, reviewed_by, site_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(100),
    view === 'history' ? sb.from('network_approvals')
      .select('id, title, action_type, requested_by, status, created_at, reviewed_at, reviewed_by, site_id')
      .in('status', ['approved', 'rejected', 'cancelled', 'executed'])
      .order('reviewed_at', { ascending: false, nullsFirst: false })
      .limit(100) : Promise.resolve({ data: [] as ApprovalRow[], error: null }),
  ]);
  const pending: ApprovalRow[]  = (pendingRes.data ?? []) as ApprovalRow[];
  const history: ApprovalRow[]  = (historyRes.data ?? []) as ApprovalRow[];

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/approvals">
      <SectionHeader
        eyebrow="Operations"
        title="Approvals"
        description={`${pending.length} awaiting review. Consequential actions queued by AI, system jobs or operators wait here for human sign-off.`}
        actions={
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <Link href="/admin/approvals" className={`ui-btn ui-btn--${view === 'pending' ? 'primary' : 'secondary'} ui-btn--sm`}>Pending</Link>
            <Link href="/admin/approvals?view=history" className={`ui-btn ui-btn--${view === 'history' ? 'primary' : 'secondary'} ui-btn--sm`}>History</Link>
          </div>
        }
      />

      {view === 'pending' ? (
        <Panel title="Pending approvals">
          {pending.length === 0 ? (
            <EmptyPanelNotice>
              No approvals waiting. Items appear here when AI drafters, system automation, or operators queue a consequential action.
            </EmptyPanelNotice>
          ) : (
            <Table<ApprovalRow>
              columns={[
                { key: 'title', header: 'Title', render: (a) => <span style={{ fontWeight: 600 }}>{a.title}</span> },
                { key: 'action', header: 'Action', render: (a) => <span className="col-dim">{a.action_type}</span> },
                { key: 'site', header: 'Site', render: (a) => <span className="col-dim">{a.site_id ? siteDisplayName(sitesById.get(a.site_id)?.slug) : 'Network'}</span> },
                { key: 'by', header: 'Requested by', render: (a) => <StatusBadge state={a.requested_by === 'human' ? 'ok' : 'info'} label={a.requested_by} /> },
                { key: 'created', header: 'Created', render: (a) => <span className="col-dim">{new Date(a.created_at).toISOString().slice(0, 10)}</span> },
                { key: 'actions', header: '', render: () => <span className="col-dim" style={{ fontSize: 11 }}>Approve/reject via its source page</span> },
              ]}
              rows={pending}
            />
          )}
        </Panel>
      ) : (
        <Panel title="Approval history" eyebrow="Most recent 100 decisions">
          {history.length === 0 ? (
            <EmptyPanelNotice>No approval history yet.</EmptyPanelNotice>
          ) : (
            <Table<ApprovalRow>
              columns={[
                { key: 'title', header: 'Title', render: (a) => <span style={{ fontWeight: 600 }}>{a.title}</span> },
                { key: 'action', header: 'Action', render: (a) => <span className="col-dim">{a.action_type}</span> },
                { key: 'site', header: 'Site', render: (a) => <span className="col-dim">{a.site_id ? siteDisplayName(sitesById.get(a.site_id)?.slug) : 'Network'}</span> },
                { key: 'status', header: 'Decision', render: (a) => <StatusBadge state={a.status} /> },
                { key: 'decided', header: 'When', render: (a) => <span className="col-dim">{a.reviewed_at ? new Date(a.reviewed_at).toISOString().slice(0, 10) : '—'}</span> },
                { key: 'reviewer', header: 'By', render: (a) => <span className="col-dim" style={{ fontSize: 11 }}>{a.reviewed_by ? a.reviewed_by.slice(0, 8) : '—'}</span> },
              ]}
              rows={history}
            />
          )}
        </Panel>
      )}
    </AdminShell>
  );
}
