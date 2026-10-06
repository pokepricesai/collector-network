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
  grossSalesSince,
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

async function loadInvoiceSummary(
  sb: Awaited<ReturnType<typeof requireAdmin>>['sb'],
): Promise<{ totals: Record<string, { settled_minor: number; paid_minor: number; count: number }>; total_count: number }> {
  try {
    const { data, count } = await sb
      .from('network_affiliate_invoices')
      .select('currency, total_minor, payment_status', { count: 'exact' })
      .limit(1000);
    const rows = (data ?? []) as Array<{ currency: string; total_minor: number; payment_status: string | null }>;
    const totals: Record<string, { settled_minor: number; paid_minor: number; count: number }> = {};
    for (const row of rows) {
      const t = totals[row.currency] ?? { settled_minor: 0, paid_minor: 0, count: 0 };
      t.count += 1;
      t.settled_minor += row.total_minor;
      if (row.payment_status && /paid/i.test(row.payment_status)) t.paid_minor += row.total_minor;
      totals[row.currency] = t;
    }
    return { totals, total_count: count ?? rows.length };
  } catch {
    return { totals: {}, total_count: 0 };
  }
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
    gross28,
    channels28, bySite28,
    clicks28, convs28,
    sponsor, pipeline, recent,
    ppClicks,
    monthly12m, chartBySite12m, chartBySource12m, rpkuPoints, observations, audit,
    invoiceSummary,
  ] = await Promise.all([
    windowBookedTotals(sb, today),
    windowBookedTotals(sb, since7),
    windowBookedTotals(sb, since28),
    windowBookedTotals(sb, mtd),
    grossSalesSince(sb, since28),
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
    loadInvoiceSummary(sb),
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
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/import">CSV (legacy)</Link>
            <Link className="ui-btn ui-btn--primary ui-btn--sm"   href="/admin/revenue/impact-reset/execute">Impact ingest</Link>
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
          <Panel title="Confirmed revenue per 1,000 active-user-days" eyebrow="Efficiency" actions={<span className="col-dim" style={{ fontSize: 11.5 }}>Denominator is a sum of daily actives — not deduplicated users</span>}>
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
          const confirmed = w?.booked_minor ?? 0;
          const pending = w?.pending_minor ?? 0;
          const attributed = confirmed + pending;
          const reversedCount = w?.reversed_count ?? 0;
          const grossRow = gross28.find((g) => g.currency === ccy);
          const invRow = invoiceSummary.totals[ccy];
          return (
            <div key={ccy} style={{ marginBottom: 18 }}>
              <h3 className="admin-eyebrow" style={{ marginBottom: 8 }}>{ccy} · last 28 days</h3>
              <div className="metric-grid metric-grid--compact">
                <MetricCard
                  label={`CONFIRMED COMMISSION (${ccy}, 28d)`}
                  value={formatMoneyMinor(confirmed, ccy)}
                  state={confirmed ? 'ok' : 'no-data'}
                  helper="cleared / approved earnings"
                />
                <MetricCard
                  label={`PENDING COMMISSION (${ccy}, 28d)`}
                  value={formatMoneyMinor(pending, ccy)}
                  state={pending ? 'ok' : 'no-data'}
                  helper="currently attributed, awaiting approval"
                />
                <MetricCard
                  label={`ATTRIBUTED COMMISSION (${ccy}, 28d)`}
                  value={formatMoneyMinor(attributed, ccy)}
                  state={attributed ? 'ok' : 'no-data'}
                  helper="confirmed + pending current payout"
                />
                <MetricCard
                  label={`GROSS SALES (${ccy}, 28d)`}
                  value={grossRow ? formatMoneyMinor(grossRow.gross_minor, ccy) : null}
                  state={grossRow ? 'ok' : 'no-data'}
                  helper={grossRow ? `${formatInt(grossRow.action_count)} Actions` : 'sales attributed through EPN'}
                />
                <MetricCard
                  label={`REVERSED (${ccy}, 28d)`}
                  value={reversedCount ? `${reversedCount}` : null}
                  state={reversedCount ? 'muted' : 'no-data'}
                  helper="transactions reversed · historical loss value is not yet available"
                />
                <MetricCard
                  label={`SETTLED / INVOICED (${ccy})`}
                  value={invRow ? formatMoneyMinor(invRow.settled_minor, ccy) : null}
                  state={invRow ? 'ok' : 'no-data'}
                  helper={invRow ? `${invRow.count} invoice(s) · ${formatMoneyMinor(invRow.paid_minor, ccy)} paid` : 'invoice sync not run yet'}
                />
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
          <strong>Attributed</strong> = confirmed + pending current payout. Confirmed and pending stay separate everywhere because approval lag makes them non-comparable without maturity context.
          Reversed Actions carry <code>current_payout = 0</code>; the historical commission lost to those reversals is not yet available (ActionUpdates would need to expose OldPayout).
          Each currency is a separate line — the system never sums across them.
        </p>
      </Panel>

      <Panel title="Windows — commission by currency" eyebrow="Today / 7d / 28d / MTD">
        <Table
          rows={windows.flatMap((w) => currencies.map((ccy) => {
            const t = pick(w.totals, ccy);
            return {
              id: `${w.id}-${ccy}`,
              window: w.label,
              label: w.from,
              currency: ccy,
              confirmed: t?.booked_minor ?? 0,
              pending: t?.pending_minor ?? 0,
              reversed_count: t?.reversed_count ?? 0,
              events: t?.event_count ?? 0,
            };
          }))}
          columns={[
            { key: 'window', header: 'Window', render: (r) => <strong>{r.window}</strong> },
            { key: 'from', header: 'From', render: (r) => <code style={{ fontSize: 11 }}>{r.label}</code> },
            { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
            { key: 'confirmed', header: 'Confirmed', className: 'num', render: (r) => formatMoneyMinor(r.confirmed, r.currency) },
            { key: 'pending', header: 'Pending', className: 'num', render: (r) => formatMoneyMinor(r.pending, r.currency) },
            { key: 'reversed', header: 'Reversed', className: 'num', render: (r) => r.reversed_count > 0 ? formatInt(r.reversed_count) : <span className="col-dim">0</span> },
            { key: 'events', header: 'Actions', className: 'num', render: (r) => formatInt(r.events) },
          ]}
        />
        <p className="col-dim" style={{ fontSize: 11, marginTop: 8 }}>
          Reversed is a transaction count — not a monetary total. Historical commission lost to reversals is not yet available from the API (ActionUpdates does not currently expose OldPayout on these transitions).
        </p>
      </Panel>

      <Panel title="By source (28d)" eyebrow="Attribution — campaign of origin">
        <Table
          rows={channels28.map((c, i) => ({ id: i, ...c, attributed: c.confirmed_minor + c.pending_minor }))}
          columns={[
            { key: 'name', header: 'Source', render: (r) => <span><strong>{r.source_name}</strong> <code className="col-dim" style={{ fontSize: 11 }}>{r.source_slug}</code></span> },
            { key: 'kind', header: 'Kind', render: (r) => <StatusBadge state="info" label={r.kind.replace(/_/g, ' ')} /> },
            { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
            { key: 'confirmed', header: 'Confirmed', className: 'num', render: (r) => formatMoneyMinor(r.confirmed_minor, r.currency) },
            { key: 'pending', header: 'Pending', className: 'num', render: (r) => formatMoneyMinor(r.pending_minor, r.currency) },
            { key: 'attributed', header: 'Attributed total', className: 'num', render: (r) => formatMoneyMinor(r.attributed, r.currency) },
            { key: 'reversed', header: 'Reversed', className: 'num', render: (r) => r.reversed_count > 0 ? formatInt(r.reversed_count) : <span className="col-dim">0</span> },
            { key: 'events', header: 'Actions', className: 'num', render: (r) => formatInt(r.event_count) },
          ]}
          empty={<EmptyState title="No affiliate revenue in the last 28 days" description={<>eBay EPN transactions sync automatically from the Impact API — see <Link href="/admin/revenue/impact-reset/execute">Impact ingest</Link>.</>} tone="muted" />}
        />
      </Panel>

      <Panel title="By site (28d)" eyebrow="Per-site · historical EPN rows have no site tag">
        <Table
          rows={bySite28.map((s, i) => ({ id: i, ...s, attributed: s.confirmed_minor + s.pending_minor }))}
          columns={[
            { key: 'site', header: 'Site', render: (r) => r.site_name ? <strong>{r.site_name}</strong> : <span className="col-dim">Site not attributable</span> },
            { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
            { key: 'confirmed', header: 'Confirmed', className: 'num', render: (r) => formatMoneyMinor(r.confirmed_minor, r.currency) },
            { key: 'pending', header: 'Pending', className: 'num', render: (r) => formatMoneyMinor(r.pending_minor, r.currency) },
            { key: 'attributed', header: 'Attributed total', className: 'num', render: (r) => formatMoneyMinor(r.attributed, r.currency) },
            { key: 'reversed', header: 'Reversed', className: 'num', render: (r) => r.reversed_count > 0 ? formatInt(r.reversed_count) : <span className="col-dim">0</span> },
            { key: 'events', header: 'Actions', className: 'num', render: (r) => formatInt(r.event_count) },
          ]}
          empty={<span className="col-dim">No per-site revenue in the window.</span>}
        />
        <p className="col-dim" style={{ fontSize: 11, marginTop: 8 }}>
          Historical EPN Actions cannot be reliably attributed to an individual Collector Network site — SubId1 coverage was partial and mixed across outbound links,
          so these rows roll up as "Site not attributable". This is expected, not a data error.
          Future outbound links will tag SubId1 with the originating site consistently; attribution improves from that point forward only.
        </p>
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

      <Panel title="Reconciled affiliate conversions by source (28d)" eyebrow="network_affiliate_conversions">
        <p className="col-dim" style={{ fontSize: 12, margin: '0 0 10px' }}>
          This table reads the <code>network_affiliate_conversions</code> table, which the legacy CSV importer populated.
          The canonical Impact API ingest writes to <code>network_revenue_events</code> directly — so an empty row count here is <strong>not</strong>
          evidence that affiliate revenue is missing. Transaction counts live in <strong>By source (28d)</strong> above.
        </p>
        <Table
          rows={convs28.map((c, i) => ({ id: i, ...c }))}
          columns={[
            { key: 'source', header: 'Source', render: (r) => <code>{r.source_slug}</code> },
            { key: 'count', header: 'Conv.', className: 'num', render: (r) => formatInt(r.conversions) },
            { key: 'amount', header: 'Value', className: 'num', render: (r) => formatMoneyMinor(r.amount_minor, r.currency) },
          ]}
          empty={<EmptyState title="network_affiliate_conversions is empty for this window" description={<>eBay EPN transactions sync automatically from the Impact API into <code>network_revenue_events</code>; this legacy conversions table is only populated by CSV import.</>} tone="muted" />}
        />
      </Panel>

      <Panel title="Recent events" eyebrow="Latest 25" actions={<Link className="status-badge status-info" href="/admin/revenue/entries">All</Link>}>
        <Table
          rows={recent}
          columns={[
            { key: 'date', header: 'Date', render: (r) => <code>{formatDateOnly(r.occurred_on)}</code> },
            { key: 'source', header: 'Source', render: (r) => r.network_revenue_sources?.display_name ?? '—' },
            { key: 'site', header: 'Site', render: (r) => r.network_sites?.name ?? <span className="col-dim">Site not attributable</span> },
            { key: 'status', header: 'Status', render: (r) => {
              const status = r.ledger_status ?? (r.source_detail?.['status'] as string | undefined) ?? r.event_kind;
              const normalised = String(status).toLowerCase();
              const badgeState =
                normalised === 'confirmed' ? 'success' :
                normalised === 'pending'   ? 'warning' :
                normalised === 'reversed' || normalised === 'reversal' || normalised === 'refund' ? 'failed' :
                'info';
              return <StatusBadge state={badgeState} label={normalised} />;
            } },
            { key: 'amount', header: 'Amount', className: 'num', render: (r) => {
              const status = r.ledger_status ?? (r.source_detail?.['status'] as string | undefined);
              const isPending = status === 'pending';
              return (
                <span style={{ opacity: isPending ? 0.7 : 1 }}>
                  {formatMoneyMinor(r.amount_minor, r.currency)}
                  {isPending && <span className="col-dim" style={{ fontSize: 10, marginLeft: 4 }}>pending</span>}
                </span>
              );
            } },
            { key: 'desc', header: 'Description', render: (r) => {
              const sd = r.source_detail as Record<string, unknown> | null;
              const payload = (sd?.['provider_payload'] ?? {}) as Record<string, unknown>;
              const campaign = payload['CampaignName'] ?? sd?.['campaign_id'] ?? null;
              const title = payload['SubId1'] ?? payload['SharedId'] ?? null;
              const primary = r.description ?? (campaign && title ? `${campaign} · ${title}` : campaign ?? title);
              return (
                <span style={{ fontSize: 12 }}>
                  {primary ? <span>{String(primary)}</span> : <span className="col-dim">—</span>}
                  {r.external_ref && (
                    <> <code className="col-dim" style={{ fontSize: 10, marginLeft: 4 }}>#{String(r.external_ref)}</code></>
                  )}
                </span>
              );
            } },
          ]}
          empty={<span className="col-dim">No revenue events yet.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
