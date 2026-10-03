import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ site?: string; status?: string; build?: string }> }

interface Row {
  id: string;
  site_id: string;
  kind: string;
  template_label: string;
  reason: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  available_count: number;
  gsc_impressions_28d: number;
  gsc_clicks_28d: number;
  related_queries: string[];
  evidence: Record<string, unknown>;
  build_status: 'proposed' | 'planned' | 'building' | 'live' | 'dismissed';
  status: 'open' | 'actioned' | 'dismissed' | 'stale';
}

export default async function PageOpportunitiesPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/seo/page-opportunities');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const siteSlug = sp.site && sp.site !== 'network' ? sp.site : null;
  const siteId = siteSlug ? sites.find((s) => s.slug === siteSlug)?.id ?? null : null;
  const status = sp.status ?? 'open';
  const build = sp.build ?? null;

  let q = sb.from('network_page_opportunities')
    .select('id, site_id, kind, template_label, reason, priority, available_count, gsc_impressions_28d, gsc_clicks_28d, related_queries, evidence, build_status, status')
    .order('gsc_impressions_28d', { ascending: false })
    .limit(300);
  if (siteId) q = q.eq('site_id', siteId);
  if (status) q = q.eq('status', status);
  if (build) q = q.eq('build_status', build);

  const { data, error } = await q;
  if (error) throw new Error(`[page-opp] fetch: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={siteSlug ?? 'network'} pathname="/admin/seo/page-opportunities">
      <SectionHeader
        eyebrow="SEO · Page opportunities"
        title="Templates we could build"
        description="Deterministic page templates per site: artist pages, species, archetypes, ink-type hubs, set-value lists. Evidence is actual GSC demand plus a sitemap existence probe. We do NOT fabricate search volume — if there's no demand yet, we say so."
      />

      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!siteSlug ? 'status-active' : 'status-not_connected'}`} href="/admin/seo/page-opportunities">Network</Link>
          {sites.map((s) => (
            <Link key={s.slug} className={`status-badge ${siteSlug === s.slug ? 'status-active' : 'status-not_connected'}`} href={`/admin/seo/page-opportunities?site=${s.slug}`}>{s.shortName}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <Link className={`status-badge ${!build ? 'status-active' : 'status-not_connected'}`} href={`/admin/seo/page-opportunities${siteSlug ? `?site=${siteSlug}` : ''}`}>All build states</Link>
          {['proposed', 'planned', 'building', 'live'].map((b) => (
            <Link key={b} className={`status-badge ${build === b ? 'status-active' : 'status-not_connected'}`} href={`/admin/seo/page-opportunities?${siteSlug ? `site=${siteSlug}&` : ''}build=${b}`}>{b}</Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel title="Nothing to show" eyebrow="Opportunities">
          <EmptyState title="No page opportunities." description="Trigger /api/sync/internal-links to populate — the page-opportunity engine runs together with internal-links." tone="muted" />
        </Panel>
      ) : (
        <Panel title={`${rows.length} template${rows.length === 1 ? '' : 's'}`} eyebrow="Opportunities">
          <Table<Row>
            columns={[
              { key: 'template', header: 'Template', render: (r) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}>
                  <strong style={{ fontSize: 13 }}>{r.template_label}</strong>
                  <span className="col-dim" style={{ fontSize: 11 }}>{r.reason}</span>
                  {r.related_queries.length > 0 && (
                    <span className="col-dim" style={{ fontSize: 11 }}>
                      Top queries: {r.related_queries.slice(0, 3).join(' · ')}
                    </span>
                  )}
                </div>
              )},
              { key: 'site',   header: 'Site',  render: (r) => sitesById.get(r.site_id)?.shortName ?? '' },
              { key: 'pri',    header: 'Priority', render: (r) => <StatusBadge state={r.priority} /> },
              { key: 'build',  header: 'Build',    render: (r) => <StatusBadge state={r.build_status === 'live' ? 'success' : r.build_status === 'dismissed' ? 'dismissed' : 'info'} label={r.build_status} /> },
              { key: 'impr',   header: 'Impressions (28d)', className: 'col-num', render: (r) => formatInt(Number(r.gsc_impressions_28d)) },
              { key: 'click',  header: 'Clicks (28d)', className: 'col-num', render: (r) => formatInt(Number(r.gsc_clicks_28d)) },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
