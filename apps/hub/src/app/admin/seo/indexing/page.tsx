import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, MetricCard, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SiteRow {
  id: string; slug: string; name: string;
  submitted: number;
  seenInSearch: number;    // pages with impressions last 28d
  inspected: number;
  indexedConfirmed: number;
  notIndexed: number;
  unknown: number;
  pendingInspection: number;
}

export default async function IndexingPage() {
  const { admin, sb } = await requireAdmin('/admin/seo/indexing');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const today = new Date();
  const since = new Date(today); since.setUTCDate(since.getUTCDate() - 28);
  const sinceIso = since.toISOString().slice(0, 10);

  const [{ data: snaps }, { data: urlDays }, { data: inspections }, { data: queue }] = await Promise.all([
    sb.from('network_sitemap_snapshots').select('site_id, submitted_count, snapshot_at').order('snapshot_at', { ascending: false }),
    sb.from('network_gsc_url_daily').select('site_id, page, impressions').gte('date', sinceIso).limit(100000),
    sb.from('network_url_inspections').select('site_id, coverage_state, verdict, indexing_state'),
    sb.from('network_url_inspection_queue').select('site_id, status'),
  ]);
  const latestSitemapBySite = new Map<string, number>();
  for (const s of (snaps ?? []) as Array<{ site_id: string; submitted_count: number }>) {
    if (!latestSitemapBySite.has(s.site_id)) latestSitemapBySite.set(s.site_id, s.submitted_count);
  }
  const impressionsBySite = new Map<string, Set<string>>();
  for (const r of (urlDays ?? []) as Array<{ site_id: string; page: string; impressions: number }>) {
    if (r.impressions <= 0) continue;
    let s = impressionsBySite.get(r.site_id);
    if (!s) { s = new Set(); impressionsBySite.set(r.site_id, s); }
    s.add(r.page);
  }

  interface InspAgg { inspected: number; indexedConfirmed: number; notIndexed: number; unknown: number }
  const inspBySite = new Map<string, InspAgg>();
  for (const r of (inspections ?? []) as Array<{ site_id: string; coverage_state: string | null; verdict: string | null }>) {
    let a = inspBySite.get(r.site_id);
    if (!a) { a = { inspected: 0, indexedConfirmed: 0, notIndexed: 0, unknown: 0 }; inspBySite.set(r.site_id, a); }
    a.inspected++;
    const cov = (r.coverage_state ?? '').toLowerCase();
    if (cov.includes('submitted and indexed') || cov.includes('indexed, not submitted')) a.indexedConfirmed++;
    else if (cov.includes('not indexed') || cov.includes('discovered') || cov.includes('crawled') || cov.includes('excluded')) a.notIndexed++;
    else a.unknown++;
  }

  const pendingBySite = new Map<string, number>();
  for (const r of (queue ?? []) as Array<{ site_id: string; status: string }>) {
    if (r.status === 'pending') pendingBySite.set(r.site_id, (pendingBySite.get(r.site_id) ?? 0) + 1);
  }

  const rows: SiteRow[] = sites.map((s) => {
    const insp = inspBySite.get(s.id) ?? { inspected: 0, indexedConfirmed: 0, notIndexed: 0, unknown: 0 };
    return {
      id: s.id, slug: s.slug, name: s.name,
      submitted: latestSitemapBySite.get(s.id) ?? 0,
      seenInSearch: impressionsBySite.get(s.id)?.size ?? 0,
      inspected: insp.inspected,
      indexedConfirmed: insp.indexedConfirmed,
      notIndexed: insp.notIndexed,
      unknown: insp.unknown,
      pendingInspection: pendingBySite.get(s.id) ?? 0,
    };
  });

  const totals = rows.reduce((acc, r) => ({
    submitted: acc.submitted + r.submitted,
    seenInSearch: acc.seenInSearch + r.seenInSearch,
    inspected: acc.inspected + r.inspected,
    indexedConfirmed: acc.indexedConfirmed + r.indexedConfirmed,
    notIndexed: acc.notIndexed + r.notIndexed,
    unknown: acc.unknown + r.unknown,
    pendingInspection: acc.pendingInspection + r.pendingInspection,
  }), { submitted: 0, seenInSearch: 0, inspected: 0, indexedConfirmed: 0, notIndexed: 0, unknown: 0, pendingInspection: 0 });

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/seo/indexing">
      <SectionHeader
        eyebrow="SEO · Indexing"
        title="Indexing visibility"
        description="Honest indexing model. We never collapse these counts into a single fake 'Indexed pages' number. Submitted = sitemap. Seen = GSC impressions last 28d. Inspected = URL Inspection cache. Indexed confirmed / Not indexed = verdict from the Inspection API. Unknown = states Google won't commit to."
      />

      <div className="metric-grid">
        <MetricCard label="Submitted (sitemaps)" value={formatInt(totals.submitted)} state="ok" />
        <MetricCard label="Seen in Search (28d)" value={formatInt(totals.seenInSearch)} state="ok" helper="URLs with ≥1 impression" />
        <MetricCard label="Inspected (cache)" value={formatInt(totals.inspected)} state="ok" />
        <MetricCard label="Indexed confirmed" value={formatInt(totals.indexedConfirmed)} state="ok" />
        <MetricCard label="Not indexed" value={formatInt(totals.notIndexed)} state="muted" />
        <MetricCard label="Unknown" value={formatInt(totals.unknown)} state="muted" />
        <MetricCard label="Pending inspection" value={formatInt(totals.pendingInspection)} state="muted" />
      </div>

      <Panel title="Per site" eyebrow="Sites">
        <Table
          columns={[
            { key: 'name',  header: 'Site',      render: (r: SiteRow) => r.name },
            { key: 'subm',  header: 'Submitted', className: 'col-num', render: (r) => formatInt(r.submitted) },
            { key: 'seen',  header: 'Seen (28d)', className: 'col-num', render: (r) => formatInt(r.seenInSearch) },
            { key: 'ins',   header: 'Inspected', className: 'col-num', render: (r) => formatInt(r.inspected) },
            { key: 'ok',    header: 'Indexed',   className: 'col-num', render: (r) => formatInt(r.indexedConfirmed) },
            { key: 'ni',    header: 'Not indexed', className: 'col-num', render: (r) => formatInt(r.notIndexed) },
            { key: 'un',    header: 'Unknown',   className: 'col-num', render: (r) => formatInt(r.unknown) },
            { key: 'pend',  header: 'Queue',     className: 'col-num', render: (r) => formatInt(r.pendingInspection) },
          ]}
          rows={rows}
        />
      </Panel>
    </AdminShell>
  );
}
