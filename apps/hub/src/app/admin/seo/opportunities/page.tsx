import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt, formatPct } from '@/lib/format';
import { kindLabel } from '@/server/opportunities/engine';
import { OpportunityActions } from './OpportunityActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ site?: string; kind?: string; status?: string }> }

interface OppRow {
  id: string;
  site_id: string;
  kind: string;
  severity: 'critical' | 'high' | 'normal' | 'low';
  page: string;
  query: string;
  title: string;
  description: string | null;
  metrics: Record<string, number>;
  status: 'open' | 'actioned' | 'dismissed' | 'stale';
  task_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

const KINDS = [
  { code: 'low_ctr',           label: 'Low CTR' },
  { code: 'striking_distance', label: 'Striking distance' },
  { code: 'zero_click',        label: 'Impressions, no clicks' },
  { code: 'declining',         label: 'Declining' },
  { code: 'gaining',           label: 'Gaining' },
  { code: 'new_query',         label: 'New query' },
];

export default async function OpportunitiesPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/seo/opportunities');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const siteSlug = sp.site && sp.site !== 'network' ? sp.site : null;
  const kind = sp.kind ?? null;
  const status = sp.status ?? 'open';

  let siteId: string | null = null;
  if (siteSlug) {
    const site = sites.find((s) => s.slug === siteSlug);
    siteId = site?.id ?? null;
  }

  let q = sb.from('network_opportunities')
    .select('id, site_id, kind, severity, page, query, title, description, metrics, status, task_id, first_seen_at, last_seen_at')
    .order('severity', { ascending: true }) // critical < high < normal < low alphabetically — but our enum order is c<h<n<l so works
    .order('metrics->impressions_28d', { ascending: false, nullsFirst: false });

  if (siteId) q = q.eq('site_id', siteId);
  if (kind)   q = q.eq('kind', kind);
  if (status) q = q.eq('status', status);
  q = q.limit(300);

  const { data, error } = await q;
  if (error) throw new Error(`[opp] fetch: ${error.message}`);
  const rows = ((data ?? []) as unknown as OppRow[]);
  const siteBySiteId = new Map(sites.map((s) => [s.id, s]));

  // Build counts for the toolbar
  const { data: countRaw } = await sb
    .from('network_opportunities')
    .select('kind, status')
    .in('status', ['open', 'actioned', 'dismissed', 'stale']);
  const kindCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  for (const r of (countRaw ?? []) as Array<{ kind: string; status: string }>) {
    if (r.status === 'open') kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  }

  const base = '/admin/seo/opportunities';
  function linkFor(args: { site?: string; kind?: string; status?: string }) {
    const u = new URLSearchParams();
    if (args.site) u.set('site', args.site);
    if (args.kind) u.set('kind', args.kind);
    if (args.status && args.status !== 'open') u.set('status', args.status);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  }

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={siteSlug ?? 'network'} pathname="/admin/seo/opportunities">
      <SectionHeader
        eyebrow="SEO · Opportunities"
        title="Opportunities"
        description="Deterministic SEO opportunities generated from the last 28 days of Google Search Console data. Create a task from any opportunity to track action."
      />

      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!siteSlug ? 'status-active' : 'status-not_connected'}`} href={linkFor({ kind: kind ?? undefined, status })}>Network</Link>
          {sites.map((s) => (
            <Link key={s.slug} className={`status-badge ${siteSlug === s.slug ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: s.slug, kind: kind ?? undefined, status })}>{s.shortName}</Link>
          ))}
        </div>
      </div>

      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!kind ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, status })}>All kinds</Link>
          {KINDS.map((k) => (
            <Link key={k.code} className={`status-badge ${kind === k.code ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, kind: k.code, status })}>
              {k.label}{kindCounts.get(k.code) ? ` (${kindCounts.get(k.code)})` : ''}
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <Link className={`status-badge ${status === 'open'      ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, kind: kind ?? undefined, status: 'open' })}>Open{statusCounts.get('open') ? ` (${statusCounts.get('open')})` : ''}</Link>
          <Link className={`status-badge ${status === 'actioned'  ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, kind: kind ?? undefined, status: 'actioned' })}>Actioned{statusCounts.get('actioned') ? ` (${statusCounts.get('actioned')})` : ''}</Link>
          <Link className={`status-badge ${status === 'dismissed' ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, kind: kind ?? undefined, status: 'dismissed' })}>Dismissed{statusCounts.get('dismissed') ? ` (${statusCounts.get('dismissed')})` : ''}</Link>
          <Link className={`status-badge ${status === 'stale'     ? 'status-active' : 'status-not_connected'}`} href={linkFor({ site: siteSlug ?? undefined, kind: kind ?? undefined, status: 'stale' })}>Stale{statusCounts.get('stale') ? ` (${statusCounts.get('stale')})` : ''}</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel title={`${status.charAt(0).toUpperCase()}${status.slice(1)} opportunities`} eyebrow="Pipeline">
          <EmptyState
            title="Nothing here."
            description={status === 'open' ? 'Either the sync has not run yet, or there are no deterministic opportunities for the chosen filter. Trigger /api/sync/opportunities after a GSC sync.' : 'No opportunities with this status.'}
            tone="muted"
          />
        </Panel>
      ) : (
        <Panel title={`${rows.length} opportunit${rows.length === 1 ? 'y' : 'ies'}`} eyebrow="Pipeline">
          <Table<OppRow>
            columns={[
              { key: 'kind',     header: 'Kind',       render: (r) => <StatusBadge state={r.severity} label={kindLabel(r.kind)} /> },
              { key: 'site',     header: 'Site',       render: (r) => <span className="col-dim">{siteBySiteId.get(r.site_id)?.shortName ?? ''}</span> },
              { key: 'target',   header: 'Target',     render: (r) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 460 }}>
                  <strong style={{ fontSize: 13 }}>{r.title}</strong>
                  {r.page && <a href={r.page} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>{r.page}</a>}
                  {r.query && !r.page && <span style={{ fontSize: 12 }}>"{r.query}"</span>}
                </div>
              )},
              { key: 'metrics',  header: 'Metrics',    className: 'col-num', render: (r) => {
                const m = r.metrics ?? {};
                const impr = (m.impressions_28d ?? m.impressions_7d ?? 0);
                const clicks = (m.clicks_28d ?? m.clicks_7d ?? 0);
                const pos = m.position_28d;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <span>{formatInt(clicks)} / {formatInt(impr)}</span>
                    <span className="col-dim" style={{ fontSize: 11 }}>CTR {impr > 0 ? formatPct(clicks / impr) : '—'}{pos != null ? ` · pos ${Number(pos).toFixed(1)}` : ''}</span>
                  </div>
                );
              }},
              { key: 'actions', header: '',            render: (r) => <OpportunityActions opportunityId={r.id} status={r.status} taskId={r.task_id} /> },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
