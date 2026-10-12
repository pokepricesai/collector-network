import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { MetricCard, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { FreshnessBadge, freshnessState } from '@/components/admin/FreshnessBadge';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  fetchFreshness, fetchNetworkTotal, fetchSiteLevel,
  priorWindow, windowDaysAgo,
} from '@/server/analytics/dashboard';
import { formatDelta, formatInt, formatPct } from '@/lib/format';
import { siteDisplayName } from '@/lib/display-names';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// SEO portfolio — the entry panel into the SEO command centre.
// Clear separation between analysis views (Pages, Queries,
// Opportunities, Changes) and action/health views (Internal links,
// Page opportunities, Sitemaps, Indexing).

export default async function SeoOverviewPage() {
  const { admin, sb } = await requireAdmin('/admin/seo');
  const sites = await listNetworkSites(sb);
  const today = new Date();
  const w28 = windowDaysAgo(today, 28);
  const w7  = windowDaysAgo(today, 7);
  const p28 = priorWindow(w28);
  const p7  = priorWindow(w7);

  const [curr28, prior28, curr7, prior7, siteLevel, freshness] = await Promise.all([
    fetchNetworkTotal(sb, w28),
    fetchNetworkTotal(sb, p28),
    fetchNetworkTotal(sb, w7),
    fetchNetworkTotal(sb, p7),
    fetchSiteLevel(sb, w28),
    fetchFreshness(sb),
  ]);

  const gscMaxDate = freshness
    .filter((f) => f.kind === 'gsc' && f.lastDataDate)
    .map((f) => f.lastDataDate!).sort().slice(-1)[0];
  const connectedSlugs = new Set(freshness.filter((f) => f.kind === 'gsc' && f.lastDataDate).map((f) => f.slug));
  const freshnessStateVal = freshnessState(
    gscMaxDate ? new Date(gscMaxDate).toISOString() : null,
    { freshHours: 72, agingHours: 120 },
  );

  const ctr28 = curr28.googleImpressions > 0 ? curr28.googleClicks / curr28.googleImpressions : null;
  const priorCtr = prior28.googleImpressions > 0 ? prior28.googleClicks / prior28.googleImpressions : null;

  interface Row {
    id: string; name: string; slug: string;
    clicks: number; impressions: number; ctr: number | null;
    position: number | null; connected: boolean; hasSearchData: boolean;
  }
  const bySite = new Map(siteLevel.map((s) => [s.slug, s]));
  const rows: Row[] = sites.map((s) => {
    const m = bySite.get(s.slug);
    const impr = m?.googleImpressions ?? 0;
    const clicks = m?.googleClicks ?? 0;
    return {
      id: s.id, name: s.name, slug: s.slug,
      clicks, impressions: impr,
      ctr: impr > 0 ? clicks / impr : null,
      position: m?.avgPosition ?? null,
      connected: connectedSlugs.has(s.slug),
      hasSearchData: impr > 0 || clicks > 0,
    };
  });

  // Comparison helpers with direction + colour.
  function deltaChip(current: number, prior: number): { label: string; tone: 'success' | 'failed' | 'muted' } {
    if (!prior) return { label: 'first data', tone: 'muted' };
    const pct = ((current - prior) / prior) * 100;
    if (Math.abs(pct) < 1) return { label: 'flat', tone: 'muted' };
    const sign = pct > 0 ? '+' : '';
    return { label: `${sign}${pct.toFixed(0)}%`, tone: pct > 0 ? 'success' : 'failed' };
  }

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/seo">
      <SectionHeader
        eyebrow="Growth · SEO"
        title="SEO Portfolio"
        description={<>
          {gscMaxDate
            ? <>GSC data through <strong>{gscMaxDate}</strong>. </>
            : 'GSC configured but no data yet. '}
          <FreshnessBadge state={freshnessStateVal} />
          <span style={{ color: 'var(--admin-text-subtle)', fontSize: 11.5 }}> · GSC has a ~3-day settling lag — recent days are provisional.</span>
        </>}
        actions={
          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/pages">Pages</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/queries">Queries</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/opportunities">Opportunities</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/changes">Changes</Link>
          </div>
        }
      />

      <Panel title="28-day performance" eyebrow="Primary KPIs">
        <div className="metric-grid metric-grid--compact">
          <MetricCard
            label="Google clicks"
            value={gscMaxDate ? formatInt(curr28.googleClicks) : null}
            state={gscMaxDate ? 'ok' : 'not-connected'}
            helper={gscMaxDate ? (() => { const d = formatDelta(curr28.googleClicks, prior28.googleClicks); return `${d.label === '—' ? 'flat' : d.label} vs prior 28d`; })() : undefined}
          />
          <MetricCard
            label="Google impressions"
            value={gscMaxDate ? formatInt(curr28.googleImpressions) : null}
            state={gscMaxDate ? 'ok' : 'not-connected'}
            helper={gscMaxDate ? (() => { const d = formatDelta(curr28.googleImpressions, prior28.googleImpressions); return `${d.label === '—' ? 'flat' : d.label} vs prior 28d`; })() : undefined}
          />
          <MetricCard
            label="CTR"
            value={ctr28 == null ? null : formatPct(ctr28)}
            state={gscMaxDate ? (ctr28 == null ? 'no-data' : 'ok') : 'not-connected'}
            helper={priorCtr == null ? undefined : (() => { const diff = ((ctr28 ?? 0) - priorCtr) * 100; return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}pp vs prior`; })()}
          />
          <MetricCard
            label="Avg position"
            value={curr28.avgPosition == null ? null : curr28.avgPosition.toFixed(1)}
            state={gscMaxDate ? (curr28.avgPosition == null ? 'no-data' : 'ok') : 'not-connected'}
            helper={prior28.avgPosition == null ? undefined : (() => { const diff = (curr28.avgPosition ?? 0) - prior28.avgPosition; return `${diff <= 0 ? '' : '+'}${diff.toFixed(1)} vs prior (lower is better)`; })()}
          />
          <MetricCard
            label="Pages with impressions"
            value={gscMaxDate ? formatInt(curr28.pagesWithImpressions) : null}
            state={gscMaxDate ? 'ok' : 'not-connected'}
            helper={gscMaxDate ? (() => { const d = formatDelta(curr28.pagesWithImpressions, prior28.pagesWithImpressions); return `${d.label === '—' ? 'flat' : d.label} vs prior`; })() : undefined}
          />
          <MetricCard
            label="Pages with clicks"
            value={gscMaxDate ? formatInt(curr28.pagesWithClicks) : null}
            state={gscMaxDate ? 'ok' : 'not-connected'}
            helper={gscMaxDate ? (() => { const d = formatDelta(curr28.pagesWithClicks, prior28.pagesWithClicks); return `${d.label === '—' ? 'flat' : d.label} vs prior`; })() : undefined}
          />
        </div>
      </Panel>

      <Panel title="7-day pulse" eyebrow="Last 7 days vs prior 7">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="Clicks"      value={gscMaxDate ? formatInt(curr7.googleClicks) : null}      state={gscMaxDate ? 'ok' : 'not-connected'} helper={gscMaxDate ? (() => { const c = deltaChip(curr7.googleClicks, prior7.googleClicks); return `${c.label} vs prior 7d`; })() : undefined} />
          <MetricCard label="Impressions" value={gscMaxDate ? formatInt(curr7.googleImpressions) : null} state={gscMaxDate ? 'ok' : 'not-connected'} helper={gscMaxDate ? (() => { const c = deltaChip(curr7.googleImpressions, prior7.googleImpressions); return `${c.label} vs prior 7d`; })() : undefined} />
          <MetricCard label="CTR"         value={curr7.googleImpressions > 0 ? formatPct(curr7.googleClicks / curr7.googleImpressions) : null} state={curr7.googleImpressions > 0 ? 'ok' : 'not-connected'} />
          <MetricCard label="Avg position" value={curr7.avgPosition == null ? null : curr7.avgPosition.toFixed(1)} state={curr7.avgPosition == null ? 'not-connected' : 'ok'} />
        </div>
      </Panel>

      <Panel title="Action &amp; health">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/opportunities">SEO opportunities</Link>
          <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/internal-links">Internal links</Link>
          <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/page-opportunities">Page opportunities</Link>
          <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/sitemaps">Sitemaps</Link>
          <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/seo/indexing">Indexing</Link>
          <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/intelligence?category=seo">Intelligence · SEO</Link>
        </div>
      </Panel>

      <Panel title="Sites · 28 days" eyebrow="Portfolio">
        <Table<Row>
          columns={[
            { key: 'site',  header: 'Site', render: (r) => (
              <Link href={`/admin/sites/${r.slug}`} style={{ fontWeight: 600, textDecoration: 'none', color: 'inherit' }}>
                {siteDisplayName(r.slug, r.name)}
              </Link>
            ) },
            { key: 'click', header: 'Clicks',        className: 'col-num', render: (r) => r.hasSearchData ? formatInt(r.clicks) : <span className="col-dim">—</span> },
            { key: 'impr',  header: 'Impressions',   className: 'col-num', render: (r) => r.hasSearchData ? formatInt(r.impressions) : <span className="col-dim">—</span> },
            { key: 'ctr',   header: 'CTR',           className: 'col-num', render: (r) => r.ctr == null ? <span className="col-dim">—</span> : formatPct(r.ctr) },
            { key: 'pos',   header: 'Avg pos',       className: 'col-num', render: (r) => r.position == null ? <span className="col-dim">—</span> : r.position.toFixed(1) },
            { key: 'state', header: 'GSC', render: (r) => (
              r.connected
                ? r.hasSearchData
                  ? <StatusBadge state="connected" label="Connected" />
                  : <StatusBadge state="warning" label="Awaiting search data" />
                : <StatusBadge state="not_connected" label="Not connected" />
            ) },
          ]}
          rows={rows}
        />
      </Panel>
    </AdminShell>
  );
}
