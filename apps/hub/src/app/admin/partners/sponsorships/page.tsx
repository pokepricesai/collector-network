import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listSponsorships } from '@/server/partners/queries';
import { formatDateOnly, formatMoneyMinor } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STATUSES = ['draft', 'proposed', 'accepted', 'active', 'renewing', 'paused', 'ended', 'cancelled'];

interface PageProps { searchParams: Promise<{ status?: string }> }

export default async function SponsorshipsPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/partners/sponsorships');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const rows = await listSponsorships(sb, { status: sp.status });

  const activeCount = rows.filter((r) => r.status === 'active').length;
  const upcomingRenewals = rows.filter((r) => (r.status === 'active' || r.status === 'renewing') && r.renewal_reminder_on && r.renewal_reminder_on >= new Date().toISOString().slice(0, 10));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/sponsorships">
      <SectionHeader
        eyebrow="Partners"
        title="Sponsorships"
        description="Deal records. Pipeline value is contracted/booked value, not realised revenue. Revenue events live separately."
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="status-badge status-active" href="/admin/partners/sponsorships/new">+ Sponsorship</Link>
            <Link className="status-badge status-not_connected" href="/admin/partners">← Partners</Link>
          </span>
        }
      />
      <Panel title="Headline" eyebrow="Active + upcoming">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          <div className="metric-card">
            <div className="metric-label">Active deals</div>
            <div className="metric-value metric-value--ok">{activeCount}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Upcoming renewals</div>
            <div className="metric-value metric-value--ok">{upcomingRenewals.length}</div>
            <div className="metric-helper">reminder date within window</div>
          </div>
        </div>
      </Panel>
      <Panel title="Filter" eyebrow="Stage">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {STATUSES.map((s) => (
            <Link key={s} href={`/admin/partners/sponsorships?status=${s}`}><span className={`status-badge status-${s === 'active' ? 'success' : s === 'cancelled' ? 'failed' : 'info'}`} style={{ cursor: 'pointer' }}>{s}</span></Link>
          ))}
          <Link href="/admin/partners/sponsorships" style={{ fontSize: 12, marginLeft: 8 }}>reset</Link>
        </div>
      </Panel>
      <Panel title={`Deals (${rows.length})`} eyebrow={sp.status ? `Filter: ${sp.status}` : 'All stages'}>
        <Table
          rows={rows}
          columns={[
            { key: 'title', header: 'Title', render: (r) => <Link href={`/admin/partners/sponsorships/${r.id}`}>{r.title}</Link> },
            { key: 'partner', header: 'Partner', render: (r) => r.network_partners?.display_name ?? '—' },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'active' ? 'success' : r.status === 'cancelled' ? 'failed' : 'info'} label={r.status} /> },
            { key: 'value', header: 'Value', className: 'num', render: (r) => formatMoneyMinor(r.total_value_minor, r.currency) },
            { key: 'term', header: 'Term', render: (r) => <span style={{ fontSize: 12 }}>{r.term_months ? `${r.term_months} mo` : '—'}</span> },
            { key: 'ends', header: 'Ends', render: (r) => r.ends_on ? formatDateOnly(r.ends_on) : <span className="col-dim">—</span> },
            { key: 'renew', header: 'Renew', render: (r) => r.renewal_reminder_on ? <code style={{ fontSize: 11 }}>{r.renewal_reminder_on}</code> : <span className="col-dim">—</span> },
          ]}
          empty={<span className="col-dim">No deals match the current filter.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
