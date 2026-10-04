import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table, EmptyState } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  totalsSince,
  revenueByChannelSince,
  revenueBySiteSince,
  clicksBySiteSince,
  conversionsBySourceSince,
  listRecentRevenueEvents,
} from '@/server/revenue/queries';
import { formatInt, formatMoneyMinor, formatMoneyMinorCompact, formatDateOnly } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function daysAgoIso(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default async function RevenuePage() {
  const { admin, sb } = await requireAdmin('/admin/revenue');
  const sites = await listNetworkSites(sb);

  const since28d = daysAgoIso(28);
  const since28dIso = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

  const [totals, channels, bySite, clicks, conversions, recent] = await Promise.all([
    totalsSince(sb, since28d),
    revenueByChannelSince(sb, since28d),
    revenueBySiteSince(sb, since28d),
    clicksBySiteSince(sb, since28dIso),
    conversionsBySourceSince(sb, since28d),
    listRecentRevenueEvents(sb, 25),
  ]);

  const totalClicks = clicks.reduce((s, r) => s + r.clicks, 0);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue">
      <SectionHeader
        eyebrow="Revenue"
        title="Revenue command centre"
        description={
          <span>
            Last 28 days. Revenue, affiliate clicks and conversions are tracked separately — a click is not a conversion.
            Figures below reflect only entries explicitly recorded. No value is ever inferred.
          </span>
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="status-badge status-active" href="/admin/revenue/entries/new">+ Manual revenue</Link>
            <Link className="status-badge status-info" href="/admin/revenue/entries">All entries</Link>
          </span>
        }
      />

      <Panel title="Totals (28d)" eyebrow="Revenue events">
        {totals.length === 0 ? (
          <EmptyState title="No revenue entries in the last 28 days" description="Add a manual entry to get started, or wait for a reconciled affiliate conversion import." tone="muted" />
        ) : (
          <div className="metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {totals.map((t) => (
              <div key={t.currency} className="metric-card">
                <div className="metric-label">Net {t.currency}</div>
                <div className="metric-value metric-value--ok">{formatMoneyMinor(t.net_minor, t.currency)}</div>
                <div className="metric-helper">
                  gross {formatMoneyMinorCompact(t.gross_minor, t.currency)} · refunds {formatMoneyMinorCompact(t.refunds_minor, t.currency)} · {t.event_count} events
                </div>
              </div>
            ))}
            <div className="metric-card">
              <div className="metric-label">Affiliate clicks (28d)</div>
              <div className="metric-value metric-value--ok">{formatInt(totalClicks)}</div>
              <div className="metric-helper">
                Ingestion only live where instrumented. Count is observational, not revenue.
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="By channel (28d)" eyebrow="Attribution">
        <Table
          rows={channels.map((c, i) => ({ id: i, ...c }))}
          columns={[
            { key: 'name', header: 'Source', render: (r) => <span><strong>{r.source_name}</strong> <code className="col-dim" style={{ fontSize: 11 }}>{r.source_slug}</code></span> },
            { key: 'kind', header: 'Kind', render: (r) => <StatusBadge state="info" label={r.kind.replace(/_/g, ' ')} /> },
            { key: 'currency', header: 'Currency', render: (r) => <code>{r.currency}</code> },
            { key: 'net', header: 'Net', className: 'num', render: (r) => formatMoneyMinor(r.net_minor, r.currency) },
            { key: 'events', header: 'Events', className: 'num', render: (r) => formatInt(r.event_count) },
          ]}
          empty={<span className="col-dim">No channel revenue in the window.</span>}
        />
      </Panel>

      <Panel title="By site (28d)" eyebrow="Per-site">
        <Table
          rows={bySite.map((s, i) => ({ id: i, ...s }))}
          columns={[
            { key: 'site', header: 'Site', render: (r) => r.site_name ? <strong>{r.site_name}</strong> : <span className="col-dim">Network-wide</span> },
            { key: 'currency', header: 'Currency', render: (r) => <code>{r.currency}</code> },
            { key: 'net', header: 'Net', className: 'num', render: (r) => formatMoneyMinor(r.net_minor, r.currency) },
            { key: 'events', header: 'Events', className: 'num', render: (r) => formatInt(r.event_count) },
          ]}
          empty={<span className="col-dim">No per-site revenue in the window.</span>}
        />
      </Panel>

      <Panel title="Affiliate signal (28d)" eyebrow="Clicks + conversions (separate)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <h3 className="admin-h3" style={{ fontSize: 13, marginBottom: 8 }}>Clicks by site</h3>
            <Table
              rows={clicks.map((c, i) => ({ id: i, ...c }))}
              columns={[
                { key: 'site', header: 'Site', render: (r) => r.site_name ?? r.site_id },
                { key: 'clicks', header: 'Clicks', className: 'num', render: (r) => formatInt(r.clicks) },
              ]}
              empty={<span className="col-dim" style={{ fontSize: 12 }}>No click ingestion active yet. Click instrumentation ships only to YGO / OP / Lorcana in Phase F.</span>}
            />
          </div>
          <div>
            <h3 className="admin-h3" style={{ fontSize: 13, marginBottom: 8 }}>Reconciled conversions by source</h3>
            <Table
              rows={conversions.map((c, i) => ({ id: i, ...c }))}
              columns={[
                { key: 'source', header: 'Source', render: (r) => <code>{r.source_slug}</code> },
                { key: 'count', header: 'Conv.', className: 'num', render: (r) => formatInt(r.conversions) },
                { key: 'amount', header: 'Value', className: 'num', render: (r) => formatMoneyMinor(r.amount_minor, r.currency) },
              ]}
              empty={<span className="col-dim" style={{ fontSize: 12 }}>No conversions imported yet. Phase 5 imports via manual CSV.</span>}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Recent events" eyebrow="Latest 25" actions={<Link className="status-badge status-info" href="/admin/revenue/entries">All</Link>}>
        <Table
          rows={recent}
          columns={[
            { key: 'date', header: 'Date', render: (r) => <code>{formatDateOnly(r.occurred_on)}</code> },
            { key: 'source', header: 'Source', render: (r) => r.network_revenue_sources?.display_name ?? '—' },
            { key: 'site', header: 'Site', render: (r) => r.network_sites?.name ?? <span className="col-dim">Network</span> },
            { key: 'kind', header: 'Kind', render: (r) => <StatusBadge state={r.event_kind === 'revenue' ? 'success' : r.event_kind === 'refund' ? 'warning' : 'info'} label={r.event_kind} /> },
            { key: 'amount', header: 'Amount', className: 'num', render: (r) => formatMoneyMinor(r.amount_minor, r.currency) },
            { key: 'desc', header: 'Description', render: (r) => <span className="col-dim" style={{ fontSize: 12 }}>{r.description ?? r.external_ref ?? ''}</span> },
          ]}
          empty={<span className="col-dim">No revenue events yet.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
