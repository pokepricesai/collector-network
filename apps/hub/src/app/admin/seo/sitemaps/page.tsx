import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt, formatRelative } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SnapRow {
  id: string;
  site_id: string;
  snapshot_at: string;
  root_url: string;
  root_status: number | null;
  shard_count: number;
  submitted_count: number;
  valid_sampled: number;
  issue_count: number;
  status: 'ok' | 'warning' | 'error';
  error_summary: string | null;
}

interface IssueRow {
  id: string;
  site_id: string;
  snapshot_id: string | null;
  issue_type: string;
  severity: 'info' | 'warning' | 'error';
  url: string | null;
  shard_url: string | null;
  http_status: number | null;
  detail: string | null;
  first_seen_at: string;
}

export default async function SitemapsPage() {
  const { admin, sb } = await requireAdmin('/admin/seo/sitemaps');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  // Latest snapshot per site.
  const { data: allSnaps } = await sb
    .from('network_sitemap_snapshots')
    .select('id, site_id, snapshot_at, root_url, root_status, shard_count, submitted_count, valid_sampled, issue_count, status, error_summary')
    .order('snapshot_at', { ascending: false })
    .limit(100);
  const latestBySite = new Map<string, SnapRow>();
  for (const s of (allSnaps ?? []) as SnapRow[]) {
    if (!latestBySite.has(s.site_id)) latestBySite.set(s.site_id, s);
  }

  // Unresolved issues (top 50 recent).
  const { data: issuesRaw } = await sb
    .from('network_sitemap_issues')
    .select('id, site_id, snapshot_id, issue_type, severity, url, shard_url, http_status, detail, first_seen_at')
    .is('resolved_at', null)
    .order('first_seen_at', { ascending: false })
    .limit(50);
  const issues = (issuesRaw ?? []) as IssueRow[];

  const siteRows = sites.map((s) => {
    const snap = latestBySite.get(s.id);
    return {
      id: s.id, slug: s.slug, name: s.name, snap,
    };
  });

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/seo/sitemaps">
      <SectionHeader
        eyebrow="SEO · Sitemaps"
        title="Sitemap monitoring"
        description="Per-site sitemap snapshots. Issues surface sitemap-level, shard-level, and URL-level problems honestly (redirects, 4xx/5xx, duplicates, wrong-host, orphans). Run /api/sync/sitemaps to refresh."
      />

      <Panel title="Latest snapshot per site" eyebrow="Sites">
        <Table
          columns={[
            { key: 'site',   header: 'Site',     render: (r: typeof siteRows[number]) => <Link href={`/admin/sites/${r.slug}`}>{r.name}</Link> },
            { key: 'status', header: 'Status',   render: (r) => r.snap ? <StatusBadge state={r.snap.status === 'ok' ? 'connected' : r.snap.status === 'warning' ? 'warning' : 'failed'} /> : <span className="col-dim">no snapshot</span> },
            { key: 'shards', header: 'Shards',   className: 'col-num', render: (r) => r.snap ? formatInt(r.snap.shard_count) : '—' },
            { key: 'subm',   header: 'Submitted URLs', className: 'col-num', render: (r) => r.snap ? formatInt(r.snap.submitted_count) : '—' },
            { key: 'valid',  header: 'Valid (sampled)', className: 'col-num', render: (r) => r.snap ? formatInt(r.snap.valid_sampled) : '—' },
            { key: 'iss',    header: 'Issues',   className: 'col-num', render: (r) => r.snap ? formatInt(r.snap.issue_count) : '—' },
            { key: 'root',   header: 'Root',     render: (r) => r.snap ? <code style={{ fontSize: 11 }}>{r.snap.root_url}</code> : <span className="col-dim">—</span> },
            { key: 'ago',    header: 'Checked',  render: (r) => r.snap ? formatRelative(r.snap.snapshot_at) : '—' },
          ]}
          rows={siteRows}
        />
      </Panel>

      <Panel title="Open issues" eyebrow="Issues">
        {issues.length === 0 ? (
          <EmptyState title="No sitemap issues." description="Every monitored site reports clean sitemaps right now." tone="muted" />
        ) : (
          <Table
            columns={[
              { key: 'site',  header: 'Site',    render: (r: IssueRow) => sitesById.get(r.site_id)?.shortName ?? r.site_id },
              { key: 'type',  header: 'Issue',   render: (r) => <StatusBadge state={r.severity === 'error' ? 'failed' : r.severity === 'warning' ? 'warning' : 'info'} label={r.issue_type.replace(/_/g, ' ')} /> },
              { key: 'url',   header: 'URL',     render: (r) => r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>{r.url}</a> : r.shard_url ? <code style={{ fontSize: 11 }}>{r.shard_url}</code> : <span className="col-dim">—</span> },
              { key: 'http',  header: 'HTTP',    className: 'col-num', render: (r) => r.http_status ?? '—' },
              { key: 'det',   header: 'Detail',  render: (r) => <span style={{ fontSize: 12 }}>{r.detail ?? ''}</span> },
              { key: 'seen',  header: 'First seen', render: (r) => formatRelative(r.first_seen_at) },
            ]}
            rows={issues}
          />
        )}
      </Panel>
    </AdminShell>
  );
}
