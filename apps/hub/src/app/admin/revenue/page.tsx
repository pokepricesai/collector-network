import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table, EmptyState, MetricCard, Notice } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
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
import { siteDisplayName } from '@/lib/display-names';

// Revenue Command Centre — Phase 2 polish pass.
//
// Information architecture:
//   1. Headline — Confirmed / Pending / Attributed / Gross /
//      Reversed / Settled per currency. Never summed.
//   2. Window totals — today / 7d / 28d / MTD per currency.
//   3. Revenue over time + status mix (12 months, charts).
//   4. By affiliate source + by site breakdowns (recent window).
//   5. RPKU efficiency with explicit maturity caveat.
//   6. Pending ageing.
//   7. Recent events (audit trail; IDs collapsed into disclosure).
//   8. Diagnostics (collapsed): legacy conversions, click signal,
//      invoice detail, link to EPN audit / Impact audit / CSV import.
//
// Accounting semantics unchanged: confirmed vs pending vs reversed,
// currency separation, no cross-currency sums.

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

interface PageProps {
  searchParams?: Promise<{ diag?: string }>;
}

export default async function RevenuePage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/revenue');
  const sites = await listNetworkSites(sb);
  const sp = (await searchParams) ?? {};
  const showDiagnostics = sp.diag === '1';

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
  void centralClickTotal28; void ppClicks;

  // Site attribution: historical EPN rows have no site tag — if
  // literally every by-site row is 'Site not attributable', show
  // one shared compact notice instead of a wide empty table.
  const anyAttributedSite = bySite28.some((s) => !!s.site_name);

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
        eyebrow="Commercial"
        title="Revenue Command Centre"
        description={<>Real revenue only. Clicks and pipeline are reported separately. Currencies are never combined. Confirmed and pending stay separate everywhere because approval lag makes them non-comparable without maturity context.</>}
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/entries">All entries</Link>
            <Link className="ui-btn ui-btn--primary ui-btn--sm"   href="/admin/revenue/impact-reset/execute">Impact ingest</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href={showDiagnostics ? '/admin/revenue' : '/admin/revenue?diag=1'}>
              {showDiagnostics ? 'Hide diagnostics' : 'Diagnostics'}
            </Link>
          </span>
        }
      />

      {/* ── Observations: maturity-aware headline ─────────── */}
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

      {/* ── Headline strip per currency ─────────────────────── */}
      <Panel title="Headline · 28 days" eyebrow="One row per currency — never combined">
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
              <h3 className="admin-eyebrow" style={{ marginBottom: 8 }}>{ccy}</h3>
              <div className="metric-grid metric-grid--compact">
                <MetricCard
                  label="Confirmed"
                  value={formatMoneyMinor(confirmed, ccy)}
                  state={confirmed ? 'ok' : 'no-data'}
                  helper="cleared / approved"
                />
                <MetricCard
                  label="Pending"
                  value={formatMoneyMinor(pending, ccy)}
                  state={pending ? 'ok' : 'no-data'}
                  helper="awaiting approval"
                />
                <MetricCard
                  label="Attributed"
                  value={formatMoneyMinor(attributed, ccy)}
                  state={attributed ? 'ok' : 'no-data'}
                  helper="confirmed + pending"
                />
                <MetricCard
                  label="Gross sales"
                  value={grossRow ? formatMoneyMinor(grossRow.gross_minor, ccy) : null}
                  state={grossRow ? 'ok' : 'no-data'}
                  helper={grossRow ? `${formatInt(grossRow.action_count)} Actions` : 'attributed via EPN'}
                />
                <MetricCard
                  label="Settled / Invoiced"
                  value={invRow ? formatMoneyMinor(invRow.settled_minor, ccy) : null}
                  state={invRow ? 'ok' : 'no-data'}
                  helper={invRow ? `${invRow.count} invoice(s) · ${formatMoneyMinor(invRow.paid_minor, ccy)} paid` : 'no invoices yet'}
                />
                <MetricCard
                  label="Reversed · count"
                  value={reversedCount ? `${reversedCount}` : null}
                  state={reversedCount ? 'muted' : 'no-data'}
                  helper="historical loss value not available"
                />
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
          <MetricCardInline label="Sponsor MRR (GBP)" value={sponsorGbp ? formatMoneyMinor(sponsorGbp.monthly_minor, 'GBP') : 'no data'} helper={sponsorGbp ? `${sponsorGbp.active_deals} active deal(s)` : undefined} />
          <MetricCardInline label="Pipeline value (GBP)" value={pipelineGbp ? formatMoneyMinor(pipelineGbp.value_minor, 'GBP') : 'no data'} helper="not revenue" />
        </div>
      </Panel>

      {/* ── Window totals ───────────────────────────────────── */}
      <Panel title="Window totals" eyebrow="Today · 7d · 28d · MTD · per currency">
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
            { key: 'from', header: 'From', render: (r) => <span className="col-dim" style={{ fontSize: 11 }}>{r.label}</span> },
            { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
            { key: 'confirmed', header: 'Confirmed', className: 'num', render: (r) => formatMoneyMinor(r.confirmed, r.currency) },
            { key: 'pending', header: 'Pending', className: 'num', render: (r) => formatMoneyMinor(r.pending, r.currency) },
            { key: 'reversed', header: 'Reversed · count', className: 'num', render: (r) => r.reversed_count > 0 ? formatInt(r.reversed_count) : <span className="col-dim">0</span> },
            { key: 'events', header: 'Actions', className: 'num', render: (r) => formatInt(r.events) },
          ]}
        />
      </Panel>

      {/* ── Trend ──────────────────────────────────────────── */}
      {(() => {
        const chartCurrencies = Array.from(new Set(monthly12m.map((m) => m.currency))).sort();
        if (chartCurrencies.length === 0) return null;
        return (
          <Panel title="Revenue over time" eyebrow="Trailing 12 months · confirmed vs pending vs reversed">
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
          <Panel title="Status mix" eyebrow="Stacked monthly confirmed · pending · reversed">
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

      {/* ── By source ──────────────────────────────────────── */}
      <Panel title="By affiliate source · 28 days" eyebrow="Campaign of origin">
        {channels28.length === 0 ? (
          <EmptyPanelNotice>No affiliate revenue in the last 28 days. eBay EPN syncs automatically from the Impact API — see <Link href="/admin/revenue/impact-reset/execute">Impact ingest</Link>.</EmptyPanelNotice>
        ) : (
          <Table
            rows={channels28.map((c, i) => ({ id: i, ...c, attributed: c.confirmed_minor + c.pending_minor }))}
            columns={[
              { key: 'name', header: 'Source', render: (r) => (
                <span>
                  <strong>{r.source_name}</strong>{' '}
                  <code className="col-dim" style={{ fontSize: 11 }}>{r.source_slug}</code>
                </span>
              ) },
              { key: 'kind', header: 'Kind', render: (r) => <StatusBadge state="info" label={r.kind.replace(/_/g, ' ')} /> },
              { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
              { key: 'confirmed', header: 'Confirmed', className: 'num', render: (r) => formatMoneyMinor(r.confirmed_minor, r.currency) },
              { key: 'pending', header: 'Pending', className: 'num', render: (r) => formatMoneyMinor(r.pending_minor, r.currency) },
              { key: 'attributed', header: 'Attributed', className: 'num', render: (r) => formatMoneyMinor(r.attributed, r.currency) },
              { key: 'reversed', header: 'Reversed · count', className: 'num', render: (r) => r.reversed_count > 0 ? formatInt(r.reversed_count) : <span className="col-dim">0</span> },
            ]}
          />
        )}
      </Panel>

      {/* ── By site ───────────────────────────────────────── */}
      <Panel title="By site · 28 days">
        {!anyAttributedSite ? (
          <EmptyPanelNotice>
            Historical site attribution unavailable. EPN Actions imported before the SubId1 cutover are not reliably mapped to an individual Collector Network site, so these rows roll up as unattributable. Site revenue will appear here once new tagged activity accrues.
          </EmptyPanelNotice>
        ) : (
          <Table
            rows={bySite28.filter((s) => s.site_name).map((s, i) => ({ id: i, ...s, attributed: s.confirmed_minor + s.pending_minor }))}
            columns={[
              { key: 'site', header: 'Site', render: (r) => <strong>{siteDisplayName(r.site_slug, r.site_name ?? 'Site')}</strong> },
              { key: 'currency', header: 'Ccy', render: (r) => <code>{r.currency}</code> },
              { key: 'confirmed', header: 'Confirmed', className: 'num', render: (r) => formatMoneyMinor(r.confirmed_minor, r.currency) },
              { key: 'pending', header: 'Pending', className: 'num', render: (r) => formatMoneyMinor(r.pending_minor, r.currency) },
              { key: 'attributed', header: 'Attributed', className: 'num', render: (r) => formatMoneyMinor(r.attributed, r.currency) },
              { key: 'reversed', header: 'Reversed', className: 'num', render: (r) => r.reversed_count > 0 ? formatInt(r.reversed_count) : <span className="col-dim">0</span> },
            ]}
            empty={<span className="col-dim">No tagged site revenue in the window.</span>}
          />
        )}
      </Panel>

      {/* ── RPKU efficiency with maturity caveat ───────────── */}
      {(() => {
        const chartCurrencies = Array.from(new Set(
          rpkuPoints.flatMap((p) => Object.keys(p.rpku_minor_by_currency)),
        )).sort();
        if (chartCurrencies.length === 0 || rpkuPoints.length === 0) return null;
        return (
          <Panel
            title="Revenue efficiency"
            eyebrow="Confirmed revenue per 1,000 active-user-days"
            actions={<span className="col-dim" style={{ fontSize: 11.5 }}>Denominator is a sum of daily actives — not deduplicated users</span>}
          >
            <Notice tone="warning">
              <strong>Maturity caveat:</strong> the current and most-recent months carry a large share of pending commission that has not yet been approved. Confirmed-RPKU for those months will look artificially low; it does <strong>not</strong> represent a monetisation collapse. Trust the status-mix chart above as the primary read, and treat recent-month RPKU as provisional.
            </Notice>
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: `repeat(auto-fit, minmax(360px, 1fr))`, marginTop: 12 }}>
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

      {/* ── Pending ageing ─────────────────────────────────── */}
      <Panel title="Pending ageing" eyebrow="How old is pending commission">
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

      {/* ── Recent events (audit trail) ────────────────────── */}
      <Panel title="Recent events" eyebrow="Latest 25 · audit trail" actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/entries">All entries</Link>}>
        <Table
          rows={recent}
          columns={[
            { key: 'date', header: 'Date', render: (r) => <code style={{ fontSize: 11 }}>{formatDateOnly(r.occurred_on)}</code> },
            { key: 'source', header: 'Source', render: (r) => r.network_revenue_sources?.display_name ?? '—' },
            { key: 'site', header: 'Site', render: (r) => r.network_sites?.name ? siteDisplayName(r.network_sites?.slug, r.network_sites?.name) : <span className="col-dim">unattributed</span> },
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
                <details style={{ fontSize: 12 }}>
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    {primary ? <span>{String(primary).slice(0, 80)}</span> : <span className="col-dim">—</span>}
                  </summary>
                  {r.external_ref && (
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--admin-text-muted)' }}>
                      ref: <code>{String(r.external_ref)}</code>
                    </div>
                  )}
                </details>
              );
            } },
          ]}
          empty={<span className="col-dim">No revenue events yet.</span>}
        />
      </Panel>

      {/* ── Diagnostics (collapsed by default) ─────────────── */}
      {showDiagnostics && (
        <Panel title="Diagnostics &amp; legacy" eyebrow="Expand only when auditing">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/audit">EPN diagnostic</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/impact-audit">Impact API audit</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue/import">CSV import (legacy)</Link>
          </div>

          <h4 className="admin-eyebrow" style={{ fontSize: 11, marginTop: 10, marginBottom: 6 }}>Click signal · 28 days (not revenue)</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div>
              <strong style={{ fontSize: 12 }}>Central (network)</strong>
              {clicks28.length === 0 ? (
                <div className="col-dim" style={{ fontSize: 12, marginTop: 4 }}>No central clicks logged.</div>
              ) : (
                <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, fontSize: 12 }}>
                  {clicks28.map((c, i) => (
                    <li key={i}>{siteDisplayName(c.site_slug, c.site_name ?? '—')}: {formatInt(c.clicks)}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <strong style={{ fontSize: 12 }}>PokePrices (read-through)</strong>
              <div className="col-dim" style={{ fontSize: 12, marginTop: 4 }}>
                {!ppClicks
                  ? 'affiliate_events not reachable (separate project)'
                  : ppClicks.total === 0
                    ? 'reachable but empty for window'
                    : `${formatInt(ppClicks.total)} · views ${formatInt(ppClicks.views)} / clicks ${formatInt(ppClicks.clicks)}`}
              </div>
            </div>
          </div>

          <h4 className="admin-eyebrow" style={{ fontSize: 11, marginBottom: 6 }}>Reconciled affiliate conversions · 28 days</h4>
          <p className="col-dim" style={{ fontSize: 11, margin: '0 0 8px' }}>
            Reads <code>network_affiliate_conversions</code> (legacy CSV importer). The canonical Impact API ingest writes to <code>network_revenue_events</code>, so an empty row count here is NOT evidence that affiliate revenue is missing.
          </p>
          <Table
            rows={convs28.map((c, i) => ({ id: i, ...c }))}
            columns={[
              { key: 'source', header: 'Source', render: (r) => <code>{r.source_slug}</code> },
              { key: 'count', header: 'Conv.', className: 'num', render: (r) => formatInt(r.conversions) },
              { key: 'amount', header: 'Value', className: 'num', render: (r) => formatMoneyMinor(r.amount_minor, r.currency) },
            ]}
            empty={<EmptyState title="network_affiliate_conversions is empty for this window" tone="muted" />}
          />
        </Panel>
      )}

      {/* ── By site breakdown chart ────────────────────────── */}
      {(() => {
        const chartCurrencies = Array.from(new Set(chartBySite12m.map((m) => m.currency))).sort();
        if (chartCurrencies.length === 0) return null;
        return (
          <Panel title="By site · trailing 12 months">
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
          <Panel title="By affiliate source · trailing 12 months">
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
    </AdminShell>
  );
}

function MetricCardInline({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div style={{ padding: '8px 12px', border: '1px solid var(--admin-border)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 180 }}>
      <div className="admin-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{value}</div>
      {helper && <div className="col-dim" style={{ fontSize: 11 }}>{helper}</div>}
    </div>
  );
}
