import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table, EmptyState, MetricCard } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  windowBookedTotals,
  sponsorMrr,
  pipelineTotals,
  revenueByChannelSince,
  revenueBySiteSince,
  clicksBySiteSince,
  conversionsBySourceSince,
  listRecentRevenueEvents,
} from '@/server/revenue/queries';
import { pokepricesClickTotals } from '@/server/revenue/pokeprices-clicks';
import { formatInt, formatMoneyMinor, formatDateOnly } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export default async function RevenuePage() {
  const { admin, sb } = await requireAdmin('/admin/revenue');
  const sites = await listNetworkSites(sb);

  const today = daysAgoIso(0);
  const since7 = daysAgoIso(7);
  const since28 = daysAgoIso(28);
  const mtd = monthStartIso();

  const [
    todayTotals, w7, w28, mtdTotals,
    channels28, bySite28,
    clicks28, convs28,
    sponsor, pipeline, recent,
    ppClicks,
  ] = await Promise.all([
    windowBookedTotals(sb, today),
    windowBookedTotals(sb, since7),
    windowBookedTotals(sb, since28),
    windowBookedTotals(sb, mtd),
    revenueByChannelSince(sb, since28),
    revenueBySiteSince(sb, since28),
    clicksBySiteSince(sb, new Date(Date.now() - 28 * 86400000).toISOString()),
    conversionsBySourceSince(sb, since28),
    sponsorMrr(sb),
    pipelineTotals(sb),
    listRecentRevenueEvents(sb, 25),
    pokepricesClickTotals(sb, since28).catch(() => null),
  ]);

  const gbp = <T extends { currency: string }>(list: T[]): T | undefined => list.find((r) => r.currency === 'GBP');
  const gbpBooked = (list: Array<{ currency: string; booked_minor: number }>) => gbp(list)?.booked_minor ?? 0;
  const gbpPending = (list: Array<{ currency: string; pending_minor: number }>) => gbp(list)?.pending_minor ?? 0;

  const sponsorGbp = sponsor.find((r) => r.currency === 'GBP');
  const pipelineGbp = pipeline.find((r) => r.currency === 'GBP');
  const centralClickTotal28 = clicks28.reduce((s, r) => s + r.clicks, 0);
  const ppClickTotal28 = ppClicks?.total ?? 0;

  const todayTxt = formatDateOnly(new Date());

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue">
      <SectionHeader
        eyebrow="Revenue"
        title="Revenue command centre"
        description={
          <span>
            Real revenue only. Clicks are shown separately. Pipeline value is contract value, not revenue.
            For the GBP line we treat <code>source_detail.status = &quot;pending&quot;</code> as pending affiliate revenue.
          </span>
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="status-badge status-active" href="/admin/revenue/import">↓ Import CSV</Link>
            <Link className="status-badge status-info" href="/admin/revenue/entries/new">+ Manual revenue</Link>
            <Link className="status-badge status-info" href="/admin/revenue/entries">All entries</Link>
          </span>
        }
      />

      <Panel title="Headline (GBP)" eyebrow="Separated signals">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="REAL BOOKED (28d)" value={formatMoneyMinor(gbpBooked(w28), 'GBP')} state={gbpBooked(w28) ? 'ok' : 'no-data'} helper="confirmed revenue events" />
          <MetricCard label="PENDING AFFILIATE (28d)" value={formatMoneyMinor(gbpPending(w28), 'GBP')} state={gbpPending(w28) ? 'ok' : 'no-data'} helper="imported, awaiting payout" />
          <MetricCard label="SPONSOR MRR" value={sponsorGbp ? formatMoneyMinor(sponsorGbp.monthly_minor, 'GBP') : null} state={sponsorGbp ? 'ok' : 'no-data'} helper={sponsorGbp ? `${sponsorGbp.active_deals} active deal(s)` : undefined} />
          <MetricCard label="PIPELINE VALUE" value={pipelineGbp ? formatMoneyMinor(pipelineGbp.value_minor, 'GBP') : null} state={pipelineGbp ? 'ok' : 'no-data'} helper={pipelineGbp ? `${pipelineGbp.deal_count} deal(s), all statuses` : 'not revenue'} />
          <MetricCard label="CLICKS (28d, network)" value={formatInt(centralClickTotal28)} state={centralClickTotal28 ? 'ok' : 'no-data'} helper="not revenue" />
        </div>
        <p className="col-dim" style={{ fontSize: 11, marginTop: 10 }}>
          REAL BOOKED, PENDING AFFILIATE, SPONSOR MRR, PIPELINE VALUE and CLICKS are deliberately separate — nothing is inferred across them.
        </p>
      </Panel>

      <Panel title="Windows — booked GBP" eyebrow="Today / 7d / 28d / MTD">
        <Table
          rows={[
            { id: 'today', window: 'Today',       booked: gbpBooked(todayTotals), pending: gbpPending(todayTotals), events: gbp(todayTotals)?.event_count ?? 0, label: todayTxt },
            { id: '7d',    window: 'Last 7 days', booked: gbpBooked(w7),          pending: gbpPending(w7),          events: gbp(w7)?.event_count ?? 0,          label: since7 },
            { id: '28d',   window: 'Last 28 days',booked: gbpBooked(w28),         pending: gbpPending(w28),         events: gbp(w28)?.event_count ?? 0,         label: since28 },
            { id: 'mtd',   window: 'Month to date',booked: gbpBooked(mtdTotals),  pending: gbpPending(mtdTotals),   events: gbp(mtdTotals)?.event_count ?? 0,   label: mtd },
          ]}
          columns={[
            { key: 'window', header: 'Window', render: (r) => <strong>{r.window}</strong> },
            { key: 'from', header: 'From', render: (r) => <code style={{ fontSize: 11 }}>{r.label}</code> },
            { key: 'booked', header: 'Real booked', className: 'num', render: (r) => formatMoneyMinor(r.booked, 'GBP') },
            { key: 'pending', header: 'Pending', className: 'num', render: (r) => formatMoneyMinor(r.pending, 'GBP') },
            { key: 'events', header: 'Events', className: 'num', render: (r) => formatInt(r.events) },
          ]}
        />
      </Panel>

      <Panel title="By source (28d)" eyebrow="Attribution">
        <Table
          rows={channels28.map((c, i) => ({ id: i, ...c }))}
          columns={[
            { key: 'name', header: 'Source', render: (r) => <span><strong>{r.source_name}</strong> <code className="col-dim" style={{ fontSize: 11 }}>{r.source_slug}</code></span> },
            { key: 'kind', header: 'Kind', render: (r) => <StatusBadge state="info" label={r.kind.replace(/_/g, ' ')} /> },
            { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
            { key: 'net', header: 'Net', className: 'num', render: (r) => formatMoneyMinor(r.net_minor, r.currency) },
            { key: 'events', header: 'Events', className: 'num', render: (r) => formatInt(r.event_count) },
          ]}
          empty={<EmptyState title="No source-attributed revenue yet (28d)" description={<>Use <Link href="/admin/revenue/import">Import CSV</Link> or <Link href="/admin/revenue/entries/new">Manual revenue</Link> to populate.</>} tone="muted" />}
        />
      </Panel>

      <Panel title="By site (28d)" eyebrow="Per-site">
        <Table
          rows={bySite28.map((s, i) => ({ id: i, ...s }))}
          columns={[
            { key: 'site', header: 'Site', render: (r) => r.site_name ? <strong>{r.site_name}</strong> : <span className="col-dim">Network-wide</span> },
            { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
            { key: 'net', header: 'Net', className: 'num', render: (r) => formatMoneyMinor(r.net_minor, r.currency) },
            { key: 'events', header: 'Events', className: 'num', render: (r) => formatInt(r.event_count) },
          ]}
          empty={<span className="col-dim">No per-site revenue in the window.</span>}
        />
      </Panel>

      <Panel title="Click signal (28d)" eyebrow="Not revenue">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <h3 className="admin-h3" style={{ fontSize: 13, marginBottom: 8 }}>Central (network) clicks</h3>
            {clicks28.length === 0 ? (
              <EmptyState title="No central clicks" description="YGO is the only live-wired specialist site. OP + Lorcana await their 3-line enable." tone="muted" />
            ) : (
              <Table
                rows={clicks28.map((c, i) => ({ id: i, ...c }))}
                columns={[
                  { key: 'site', header: 'Site', render: (r) => r.site_name ?? r.site_id },
                  { key: 'clicks', header: 'Clicks', className: 'num', render: (r) => formatInt(r.clicks) },
                ]}
              />
            )}
          </div>
          <div>
            <h3 className="admin-h3" style={{ fontSize: 13, marginBottom: 8 }}>PokePrices clicks (read-through)</h3>
            {!ppClicks ? (
              <EmptyState title="PokePrices affiliate_events not reachable" description="If pokeprices-web lives in a separate Supabase project, surfacing historical clicks requires an admin service-role token or an import script." tone="muted" />
            ) : ppClicks.total === 0 ? (
              <EmptyState title="No PokePrices clicks in window" description="affiliate_events table reachable but empty for the window." tone="muted" />
            ) : (
              <>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{formatInt(ppClicks.total)}</div>
                <div className="col-dim" style={{ fontSize: 12 }}>
                  views {formatInt(ppClicks.views)} · clicks {formatInt(ppClicks.clicks)} · from pokeprices-web public.affiliate_events (read-only)
                </div>
              </>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Reconciled affiliate conversions by source (28d)" eyebrow="Imported rows">
        <Table
          rows={convs28.map((c, i) => ({ id: i, ...c }))}
          columns={[
            { key: 'source', header: 'Source', render: (r) => <code>{r.source_slug}</code> },
            { key: 'count', header: 'Conv.', className: 'num', render: (r) => formatInt(r.conversions) },
            { key: 'amount', header: 'Value', className: 'num', render: (r) => formatMoneyMinor(r.amount_minor, r.currency) },
          ]}
          empty={<EmptyState title="No affiliate conversions imported yet" description={<>Use <Link href="/admin/revenue/import">Import CSV</Link> to add EPN rows.</>} tone="muted" />}
        />
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
