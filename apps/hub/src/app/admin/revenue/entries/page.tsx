import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listRecentRevenueEvents } from '@/server/revenue/queries';
import { formatMoneyMinor, formatDateOnly, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface PageProps { searchParams: Promise<{ inserted?: string }> }

export default async function EntriesPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/revenue/entries');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const rows = await listRecentRevenueEvents(sb, 200);
  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/entries">
      <SectionHeader
        eyebrow="Revenue"
        title="Revenue entries"
        description="Append-only ledger of recorded revenue events. Corrections are additional rows (refund / reversal), never edits."
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="status-badge status-active" href="/admin/revenue/entries/new">+ New entry</Link>
            <Link className="status-badge status-not_connected" href="/admin/revenue">← Dashboard</Link>
          </span>
        }
      />
      {sp.inserted === '1' && (
        <Panel title="Entry recorded" eyebrow="OK">
          <span className="col-dim" style={{ fontSize: 12 }}>The row was inserted (or skipped as idempotent re-submit). Dashboard totals have been revalidated.</span>
        </Panel>
      )}
      <Panel title={`All entries (${rows.length})`} eyebrow="Ledger">
        <Table
          rows={rows}
          columns={[
            { key: 'date', header: 'Occurred', render: (r) => <code>{formatDateOnly(r.occurred_on)}</code> },
            { key: 'kind', header: 'Kind', render: (r) => <StatusBadge state={r.event_kind === 'revenue' ? 'success' : r.event_kind === 'refund' ? 'warning' : 'info'} label={r.event_kind} /> },
            { key: 'source', header: 'Source', render: (r) => r.network_revenue_sources?.display_name ?? '—' },
            { key: 'site', header: 'Site', render: (r) => r.network_sites?.name ?? <span className="col-dim">Network</span> },
            { key: 'amount', header: 'Amount', className: 'num', render: (r) => formatMoneyMinor(r.amount_minor, r.currency) },
            { key: 'desc', header: 'Description', render: (r) => <span style={{ fontSize: 12 }}>{r.description ?? ''}</span> },
            { key: 'ref', header: 'Ref', render: (r) => r.external_ref ? <code style={{ fontSize: 11 }}>{r.external_ref}</code> : <span className="col-dim">—</span> },
            { key: 'recorded', header: 'Recorded', render: (r) => <span className="col-dim" style={{ fontSize: 11 }}>{formatRelative(r.recorded_at)}</span> },
          ]}
          empty={<span className="col-dim">No entries recorded yet.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
