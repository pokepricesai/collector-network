import { AdminShell } from '@/components/admin/AdminShell';
import { MetricCard, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  fetchFreshness, fetchNetworkTotal, fetchSiteLevel,
  priorWindow, windowDaysAgo,
} from '@/server/analytics/dashboard';
import { formatDelta, formatInt, formatPct } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// SEO overview — the entry panel into the SEO command centre. Three
// cross-site snapshots: 28d totals, 7d pulse, per-site breakdown.
// Links out to /admin/seo/pages, /admin/seo/queries, /admin/seo/opportunities.

export default async function SeoOverviewPage() {
  const { admin, sb } = await requireAdmin('/admin/seo');
  const sites = await listNetworkSites(sb);
  const today = new Date();
  const w28 = windowDaysAgo(today, 28);
  const w7  = windowDaysAgo(today, 7);
  const p28 = priorWindow(w28);

  const [curr28, prior28, curr7, siteLevel, freshness] = await Promise.all([
    fetchNetworkTotal(sb, w28),
    fetchNetworkTotal(sb, p28),
    fetchNetworkTotal(sb, w7),
    fetchSiteLevel(sb, w28),
    fetchFreshness(sb),
  ]);

  const gscMaxDate = freshness
    .filter((f) => f.kind === 'gsc' && f.lastDataDate)
    .map((f) => f.lastDataDate!).sort().slice(-1)[0];
  const connectedSlugs = new Set(freshness.filter((f) => f.kind === 'gsc' && f.lastDataDate).map((f) => f.slug));

  const ctr28 = curr28.googleImpressions > 0 ? curr28.googleClicks / curr28.googleImpressions : null;
  const priorCtr = prior28.googleImpressions > 0 ? prior28.googleClicks / prior28.googleImpressions : null;

  interface Row {
    id: string; name: string; slug: string;
    clicks: number; impressions: number; ctr: number | null;
    position: number | null; connected: boolean;
  }
  const bySite = new Map(siteLevel.map((s) => [s.slug, s]));
  const rows: Row[] = sites.map((s) => {
    const m = bySite.get(s.slug);
    const impr = m?.googleImpressions ?? 0;
    return {
      id: s.id, name: s.name, slug: s.slug,
      clicks: m?.googleClicks ?? 0, impressions: impr,
      ctr: impr > 0 ? (m?.googleClicks ?? 0) / impr : null,
      position: m?.avgPosition ?? null,
      connected: connectedSlugs.has(s.slug),
    };
  });

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/seo">
      <SectionHeader
        eyebrow="SEO"
        title="SEO portfolio"
        description={gscMaxDate
          ? `Google Search Console data through ${gscMaxDate}. GSC has a ~3-day settling lag — recent days should be treated as provisional.`
          : 'Google Search Console is configured but no data yet. Trigger /api/sync/backfill?kind=gsc to populate.'}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link className="status-badge status-active" href="/admin/seo/pages">Pages →</Link>
            <Link className="status-badge status-active" href="/admin/seo/queries">Queries →</Link>
            <Link className="status-badge status-opportunity" href="/admin/seo/opportunities">Opportunities →</Link>
          </div>
        }
      />

      <div className="metric-grid">
        <MetricCard
          label="Google clicks (28d)"
          value={gscMaxDate ? formatInt(curr28.googleClicks) : null}
          state={gscMaxDate ? 'ok' : 'not-connected'}
          helper={gscMaxDate ? (() => { const d = formatDelta(curr28.googleClicks, prior28.googleClicks); return `${d.label === '—' ? 'flat' : d.label} vs prior 28d`; })() : undefined}
        />
        <MetricCard
          label="Google impressions (28d)"
          value={gscMaxDate ? formatInt(curr28.googleImpressions) : null}
          state={gscMaxDate ? 'ok' : 'not-connected'}
          helper={gscMaxDate ? (() => { const d = formatDelta(curr28.googleImpressions, prior28.googleImpressions); return `${d.label === '—' ? 'flat' : d.label} vs prior 28d`; })() : undefined}
        />
        <MetricCard
          label="CTR (28d)"
          value={ctr28 == null ? null : formatPct(ctr28)}
          state={gscMaxDate ? (ctr28 == null ? 'no-data' : 'ok') : 'not-connected'}
          helper={priorCtr == null ? undefined : `prior ${formatPct(priorCtr)}`}
        />
        <MetricCard
          label="Avg position (28d)"
          value={curr28.avgPosition == null ? null : curr28.avgPosition.toFixed(1)}
          state={gscMaxDate ? (curr28.avgPosition == null ? 'no-data' : 'ok') : 'not-connected'}
          helper={prior28.avgPosition == null ? undefined : `prior ${prior28.avgPosition.toFixed(1)}`}
        />
        <MetricCard
          label="Pages with impressions"
          value={gscMaxDate ? formatInt(curr28.pagesWithImpressions) : null}
          state={gscMaxDate ? 'ok' : 'not-connected'}
          helper={gscMaxDate ? `prior ${formatInt(prior28.pagesWithImpressions)}` : undefined}
        />
        <MetricCard
          label="Pages with clicks"
          value={gscMaxDate ? formatInt(curr28.pagesWithClicks) : null}
          state={gscMaxDate ? 'ok' : 'not-connected'}
          helper={gscMaxDate ? `prior ${formatInt(prior28.pagesWithClicks)}` : undefined}
        />
      </div>

      <Panel title="7-day pulse" eyebrow="Last 7 days">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="Clicks"             value={gscMaxDate ? formatInt(curr7.googleClicks) : null}      state={gscMaxDate ? 'ok' : 'not-connected'} />
          <MetricCard label="Impressions"        value={gscMaxDate ? formatInt(curr7.googleImpressions) : null} state={gscMaxDate ? 'ok' : 'not-connected'} />
          <MetricCard label="CTR"                value={curr7.googleImpressions > 0 ? formatPct(curr7.googleClicks / curr7.googleImpressions) : null} state={curr7.googleImpressions > 0 ? 'ok' : 'not-connected'} />
          <MetricCard label="Avg position"       value={curr7.avgPosition == null ? null : curr7.avgPosition.toFixed(1)} state={curr7.avgPosition == null ? 'not-connected' : 'ok'} />
        </div>
      </Panel>

      <Panel title="Sites · 28 days" eyebrow="Portfolio">
        <Table<Row>
          columns={[
            { key: 'site',  header: 'Site',          render: (r) => <Link href={`/admin/sites/${r.slug}`}>{r.name}</Link> },
            { key: 'click', header: 'Clicks',        className: 'col-num', render: (r) => r.connected ? formatInt(r.clicks) : <span className="col-dim">Not connected</span> },
            { key: 'impr',  header: 'Impressions',   className: 'col-num', render: (r) => r.connected ? formatInt(r.impressions) : <span className="col-dim">—</span> },
            { key: 'ctr',   header: 'CTR',           className: 'col-num', render: (r) => r.ctr == null ? <span className="col-dim">—</span> : formatPct(r.ctr) },
            { key: 'pos',   header: 'Avg pos',       className: 'col-num', render: (r) => r.position == null ? <span className="col-dim">—</span> : r.position.toFixed(1) },
            { key: 'state', header: 'GSC',           render: (r) => <StatusBadge state={r.connected ? 'connected' : 'not_connected'} /> },
          ]}
          rows={rows}
        />
      </Panel>
    </AdminShell>
  );
}
