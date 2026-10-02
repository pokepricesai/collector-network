import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { fetchFreshness, iso, windowDaysAgo } from '@/server/analytics/dashboard';
import { fetchTopQueries, type SeoListRow } from '@/server/analytics/seo';
import { formatInt, formatPct } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Params { searchParams: Promise<{ site?: string; days?: string; sort?: string }> }

export default async function SeoQueriesPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/seo/queries');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const siteSlug = sp.site && sp.site !== 'network' ? sp.site : null;
  const days = sp.days === '7' ? 7 : 28;
  const orderBy: 'clicks' | 'impressions' = sp.sort === 'impressions' ? 'impressions' : 'clicks';
  const w = windowDaysAgo(new Date(), days);
  const freshness = await fetchFreshness(sb);
  const gscMaxDate = freshness.filter((f) => f.kind === 'gsc' && f.lastDataDate).map((f) => f.lastDataDate!).sort().slice(-1)[0];
  const rows: SeoListRow[] = await fetchTopQueries(sb, {
    siteSlug,
    start: iso(w.start),
    end: iso(w.end),
    orderBy,
    limit: 200,
  });
  const siteBySiteId = new Map(sites.map((s) => [s.id, s]));

  const base = '/admin/seo/queries';
  function linkFor(args: { site?: string; days?: number; sort?: string }) {
    const u = new URLSearchParams();
    if (args.site) u.set('site', args.site);
    if (args.days && args.days !== 28) u.set('days', String(args.days));
    if (args.sort && args.sort !== 'clicks') u.set('sort', args.sort);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  }

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={siteSlug ?? 'network'} pathname="/admin/seo/queries">
      <SectionHeader
        eyebrow="SEO · Queries"
        title={siteSlug ? `Top queries — ${sites.find((s) => s.slug === siteSlug)?.name ?? siteSlug}` : 'Top queries — network-wide'}
        description={gscMaxDate ? `GSC data through ${gscMaxDate}. Window: last ${days} days.` : 'GSC not synced yet.'}
      />

      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!siteSlug ? 'status-active' : 'status-not_connected'}`} href={linkFor({ days, sort: orderBy })}>Network</Link>
          {sites.map((s) => (
            <Link key={s.slug} className={`status-badge ${siteSlug === s.slug ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: s.slug, days, sort: orderBy })}>{s.shortName}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <Link className={`status-badge ${days === 7  ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, days: 7,  sort: orderBy })}>7d</Link>
          <Link className={`status-badge ${days === 28 ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, days: 28, sort: orderBy })}>28d</Link>
          <Link className={`status-badge ${orderBy === 'clicks'      ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, days, sort: 'clicks' })}>Sort: Clicks</Link>
          <Link className={`status-badge ${orderBy === 'impressions' ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, days, sort: 'impressions' })}>Sort: Impressions</Link>
        </div>
      </div>

      <Panel title="Top queries" eyebrow={orderBy === 'clicks' ? 'by clicks' : 'by impressions'}>
        <Table<SeoListRow & { id: string }>
          columns={[
            { key: 'site',  header: 'Site',  render: (r) => <span className="col-dim">{siteBySiteId.get(r.siteId)?.shortName ?? ''}</span> },
            { key: 'query', header: 'Query', render: (r) => r.query },
            { key: 'clicks', header: 'Clicks', className: 'col-num', render: (r) => formatInt(r.clicks) },
            { key: 'impr',   header: 'Impressions', className: 'col-num', render: (r) => formatInt(r.impressions) },
            { key: 'ctr',    header: 'CTR', className: 'col-num', render: (r) => r.impressions > 0 ? formatPct(r.clicks / r.impressions) : '—' },
            { key: 'pos',    header: 'Avg pos', className: 'col-num', render: (r) => r.position_avg == null ? '—' : r.position_avg.toFixed(1) },
          ]}
          rows={rows.map((r, i) => ({ ...r, id: `${r.siteId}-${i}` }))}
          empty={<em>No queries recorded yet.</em>}
        />
      </Panel>
    </AdminShell>
  );
}
