import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table, EmptyState, MetricCard, Notice } from '@/components/admin/admin-ui';
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
import {
  monthlyRevenueByCurrency,
  revenueBySite as chartRevenueBySite,
  revenueBySource as chartRevenueBySource,
  revenuePerThousandUsers,
} from '@/server/revenue/charts';
import { monthlyObservations } from '@/server/revenue/observations';
import { fetchLedgerAudit } from '@/server/revenue/audit';
import {
  RevenueOverTimeChart,
  StatusMixChart,
  BreakdownBarChart,
  RpkuChart,
} from '@/components/charts/RevenueCharts';

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
    monthly12m, chartBySite12m, chartBySource12m, rpkuPoints, observations, audit,
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
    monthlyRevenueByCurrency(sb, '12m'),
    chartRevenueBySite(sb, '12m'),
    chartRevenueBySource(sb, '12m'),
    revenuePerThousandUsers(sb, '12m'),
    monthlyObservations(sb),
    fetchLedgerAudit(sb),
  ]);

  // Union of all currencies that appear in any window. We iterate
  // this to render one metric column per currency so GBP + USD + …
  // never get combined into a single number.
  const currencies = Array.from(new Set<string>([
    ...todayTotals.map((r) => r.currency),
    ...w7.map((r) => r.currency),
    ...w28.map((r) => r.currency),
    ...mtdTotals.map((r) => r.currency),
  ])).sort();
  if (currencies.length === 0) currencies.push('GBP');

  const pick = <T extends { currency: string }>(list: T[], ccy: string): T | undefined =>
    list.find((r) => r.currency === ccy);

  const sponsorGbp = sponsor.find((r) => r.currency === 'GBP');
  const pipelineGbp = pipeline.find((r) => r.currency === 'GBP');
  const centralClickTotal28 = clicks28.reduce((s, r) => s + r.clicks, 0);
  const ppClickTotal28 = ppClicks?.total ?? 0;

  const todayTxt = formatDateOnly(new Date());

  const windows = [
    { id: 'today', label: 'Today',          totals: todayTotals, from: todayTxt },
    { id: '7d',    label: 'Last 7 days',    totals: w7,          from: since7 },
    { id: '28d',   label: 'Last 28 days',   totals: w28,         from: since28 },
    { id: 'mtd',   label: 'Month to date',  totals: mtdTotals,   from: mtd },
  ];

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue">
      <SectionHeader
        eyebrow="Revenue"
        title="Revenue command centre"
        description={
          <span>
            Real revenue only. Clicks are shown separately. Pipeline value is contract value, not revenue.
            Currencies are never combined.
          </span>
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/audit">EPN diagnostic</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/impact-audit">Impact API audit</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/entries">All entries</Link>
            <Link className="ui-btn ui-btn--primary ui-btn--sm"   href="/admin/revenue/import">Import CSV</Link>
          </span>
        }
      />

      {observations.length > 0 && (
        <Panel title="What the data is saying" eyebrow="Monthly observations">
          <div style={{ display: 'grid', gap: 8 }}>
            {observations.map((o) => (
              <Notice key={o.id} tone={o.tone === 'positive' ? 'success' : o.tone === 'negative' ? 'danger' : o.tone === 'warning' ? 'warning' : 'info'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong style={{ fontSize: 13 }}>{o.headline}</strong>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>{o.evidence}</span>
                </div>
              </Notice>
            ))}
          </div>
        </Panel>
      )}

      {(() => {
        const chartCurrencies = Array.from(new Set(monthly12m.map((m) => m.currency))).sort();
        if (chartCurrencies.length === 0) return null;
        return (
          <Panel title="Revenue over time" eyebrow="Trailing 12 months" actions={<span className="col-dim" style={{ fontSize: 11.5 }}>Confirmed vs pending vs reversed, by month</span>}>
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: `repeat(auto-fit, minmax(360px, 1fr))` }}>
              {chartCurrencies.map((ccy) => (
                <div key={ccy}>
                  <div className="admin-eyebrow" style={{ marginBottom: 6 }}>{ccy}</div>
                  <RevenueOverTimeChart currency={ccy} data={monthly12m.filter((m) => m.currency === ccy)} />
                </div>
              ))}
            </div>
          </Panel>
        );
      })()}

      {(() => {
        const chartCurrencies = Array.from(new Set(monthly12m.map((m) => m.currency))).sort();
        if (chartCurrencies.length === 0) return null;
        return (
          <Panel title="Status mix" eyebrow="Confirmed · pending · reversed" actions={<span className="col-dim" style={{ fontSize: 11.5 }}>Stacked monthly, by currency</span>}>
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: `repeat(auto-fit, minmax(360px, 1fr))` }}>
              {chartCurrencies.map((ccy) => (
                <div key={ccy}>
                  <div className="admin-eyebrow" style={{ marginBottom: 6 }}>{ccy}</div>
                  <StatusMixChart currency={ccy} data={monthly12m.filter((m) => m.currency === ccy)} />
                </div>
              ))}
            </div>
          </Panel>
        );
      })()}

      {(() => {
        const chartCurrencies = Array.from(new Set(chartBySite12m.map((m) => m.currency))).sort();
        if (chartCurrencies.length === 0) return null;
        return (
          <Panel title="By site" eyebrow="Trailing 12 months">
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: `repeat(auto-fit, minmax(360px, 1fr))` }}>
              {chartCurrencies.map((ccy) => (
                <div key={ccy}>
                  <div className="admin-eyebrow" style={{ marginBottom: 6 }}>{ccy}</div>
                  <BreakdownBarChart
                    currency={ccy}
                    rows={chartBySite12m
                      .filter((m) => m.currency === ccy)
                      .map((m) => ({ label: m.site_name, confirmed_minor: m.confirmed_minor, pending_minor: m.pending_minor }))}
                  />
                </div>
              ))}
            </div>
          </Panel>
        );
      })()}

      {(() => {
        const chartCurrencies = Array.from(new Set(chartBySource12m.map((m) => m.currency))).sort();
        if (chartCurrencies.length === 0) return null;
        return (
          <Panel title="By affiliate source" eyebrow="Trailing 12 months">
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: `repeat(auto-fit, minmax(360px, 1fr))` }}>
              {chartCurrencies.map((ccy) => (
                <div key={ccy}>
                  <div className="admin-eyebrow" style={{ marginBottom: 6 }}>{ccy}</div>
                  <BreakdownBarChart
                    currency={ccy}
                    rows={chartBySource12m
                      .filter((m) => m.currency === ccy)
                      .map((m) => ({ label: m.source_name, confirmed_minor: m.confirmed_minor, pending_minor: m.pending_minor }))}
                  />
                </div>
              ))}
            </div>
          </Panel>
        );
      })()}

      {(() => {
        const chartCurrencies = Array.from(new Set(
          rpkuPoints.flatMap((p) => Object.keys(p.rpku_minor_by_currency)),
        )).sort();
        if (chartCurrencies.length === 0 || rpkuPoints.length === 0) return null;
        return (
          <Panel title="Revenue per 1,000 users" eyebrow="Efficiency" actions={<span className="col-dim" style={{ fontSize: 11.5 }}>(confirmed revenue ÷ summed daily active users) × 1,000</span>}>
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: `repeat(auto-fit, minmax(360px, 1fr))` }}>
              {chartCurrencies.map((ccy) => (
                <div key={ccy}>
                  <div className="admin-eyebrow" style={{ marginBottom: 6 }}>{ccy}</div>
                  <RpkuChart
                    currency={ccy}
                    data={rpkuPoints.map((p) => ({
                      bucket: p.bucket,
                      users: p.users,
                      rpku_minor: p.rpku_minor_by_currency[ccy] ?? 0,
                    }))}
                  />
                </div>
              ))}
            </div>
          </Panel>
        );
      })()}

      <Panel title="Pending ageing" eyebrow="How old is pending commission">
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          Based on <code>occurred_on</code> relative to today. Only rows currently flagged <code>pending</code>.
          We do not yet have enough transition history to estimate clearance probability truthfully — that will land once reconciled imports accumulate.
        </p>
        <Table
          columns={[
            { key: 'bucket', header: 'Age', render: (r) => <strong>{r.bucket}</strong> },
            { key: 'rows', header: 'Rows', className: 'col-num', render: (r) => r.rows.toLocaleString() },
            { key: 'gbp', header: 'GBP', className: 'col-num', render: (r) => r.gbp != null ? formatMoneyMinor(r.gbp, 'GBP') : <span className="col-dim">—</span> },
            { key: 'usd', header: 'USD', className: 'col-num', render: (r) => r.usd != null ? formatMoneyMinor(r.usd, 'USD') : <span className="col-dim">—</span> },
          ]}
          rows={audit.aged_pending.map((b, i) => ({
            id: i,
            bucket: b.bucket,
            rows: b.rows,
            gbp: b.amount_minor_by_currency['GBP'] ?? null,
            usd: b.amount_minor_by_currency['USD'] ?? null,
          }))}
          empty="No pending rows."
        />
      </Panel>

      <Panel title="Headline — separated by currency" eyebrow="Never combined">
        {currencies.map((ccy) => {
          const w = pick(w28, ccy);
          const booked = w?.booked_minor ?? 0;
          const pending = w?.pending_minor ?? 0;
          const refunds = w?.refunds_minor ?? 0;
          return (
            <div key={ccy} style={{ marginBottom: 18 }}>
              <h3 className="admin-eyebrow" style={{ marginBottom: 8 }}>{ccy} · last 28 days</h3>
              <div className="metric-grid metric-grid--compact">
                <MetricCard label={`REAL BOOKED (${ccy}, 28d)`} value={formatMoneyMinor(booked, ccy)} state={booked ? 'ok' : 'no-data'} helper="confirmed revenue events" />
                <MetricCard label={`PENDING AFFILIATE (${ccy}, 28d)`} value={formatMoneyMinor(pending, ccy)} state={pending ? 'ok' : 'no-data'} helper="imported, awaiting payout" />
                <MetricCard label={`REFUNDS / REVERSALS (${ccy}, 28d)`} value={formatMoneyMinor(refunds, ccy)} state={refunds ? 'ok' : 'no-data'} helper="stored negative, kept separate" />
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 6 }}>
          <h3 className="admin-eyebrow" style={{ marginBottom: 8 }}>Non-currency signals</h3>
          <div className="metric-grid metric-grid--compact">
            <MetricCard label="SPONSOR MRR (GBP)" value={sponsorGbp ? formatMoneyMinor(sponsorGbp.monthly_minor, 'GBP') : null} state={sponsorGbp ? 'ok' : 'no-data'} helper={sponsorGbp ? `${sponsorGbp.active_deals} active deal(s)` : undefined} />
            <MetricCard label="PIPELINE VALUE (GBP)" value={pipelineGbp ? formatMoneyMinor(pipelineGbp.value_minor, 'GBP') : null} state={pipelineGbp ? 'ok' : 'no-data'} helper={pipelineGbp ? `${pipelineGbp.deal_count} deal(s), all statuses` : 'not revenue'} />
            <MetricCard label="CLICKS (28d, network)" value={formatInt(centralClickTotal28)} state={centralClickTotal28 ? 'ok' : 'no-data'} helper="not revenue" />
          </div>
        </div>
        <p className="col-dim" style={{ fontSize: 11, marginTop: 10 }}>
          Each currency is a separate line — the system never sums across them. SPONSOR MRR + PIPELINE are shown in GBP because they come from deal records you enter directly.
          No FX conversion is applied to any revenue event; <code>amount_minor</code> + <code>currency</code> on each row are the frozen original values.
        </p>
      </Panel>

      <Panel title="Windows — booked by currency" eyebrow="Today / 7d / 28d / MTD">
        <Table
          rows={windows.flatMap((w) => currencies.map((ccy) => {
            const t = pick(w.totals, ccy);
            return {
              id: `${w.id}-${ccy}`,
              window: w.label,
              label: w.from,
              currency: ccy,
              booked: t?.booked_minor ?? 0,
              pending: t?.pending_minor ?? 0,
              refunds: t?.refunds_minor ?? 0,
              events: t?.event_count ?? 0,
            };
          }))}
          columns={[
            { key: 'window', header: 'Window', render: (r) => <strong>{r.window}</strong> },
            { key: 'from', header: 'From', render: (r) => <code style={{ fontSize: 11 }}>{r.label}</code> },
            { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
            { key: 'booked', header: 'Real booked', className: 'num', render: (r) => formatMoneyMinor(r.booked, r.currency) },
            { key: 'pending', header: 'Pending', className: 'num', render: (r) => formatMoneyMinor(r.pending, r.currency) },
            { key: 'refunds', header: 'Refunds', className: 'num', render: (r) => formatMoneyMinor(r.refunds, r.currency) },
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
