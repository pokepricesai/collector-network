import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { InternalLinkActions } from './InternalLinkActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ site?: string; reason?: string; status?: string }> }

interface Row {
  id: string;
  site_id: string;
  source_url: string;
  target_url: string;
  reason: string;
  relationship: string | null;
  priority: 'critical' | 'high' | 'normal' | 'low';
  confidence: 'low' | 'medium' | 'high';
  evidence: Record<string, unknown>;
  status: 'open' | 'actioned' | 'dismissed' | 'stale';
  task_id: string | null;
}

export default async function InternalLinksPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/seo/internal-links');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const siteSlug = sp.site && sp.site !== 'network' ? sp.site : null;
  const status = sp.status ?? 'open';
  const reason = sp.reason ?? null;
  const siteId = siteSlug ? sites.find((s) => s.slug === siteSlug)?.id ?? null : null;

  let q = sb.from('network_internal_link_opportunities')
    .select('id, site_id, source_url, target_url, reason, relationship, priority, confidence, evidence, status, task_id')
    .order('priority', { ascending: true })
    .limit(300);
  if (siteId) q = q.eq('site_id', siteId);
  if (reason) q = q.eq('reason', reason);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(`[il] fetch: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={siteSlug ?? 'network'} pathname="/admin/seo/internal-links">
      <SectionHeader
        eyebrow="SEO · Internal Links"
        title="Internal-link opportunities"
        description="Evidence-backed internal-link suggestions. Not random keyword links — these come from site structure, GSC query overlap, and page authority signals. Create a task to track action."
      />

      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!siteSlug ? 'status-active' : 'status-not_connected'}`} href="/admin/seo/internal-links">Network</Link>
          {sites.map((s) => (
            <Link key={s.slug} className={`status-badge ${siteSlug === s.slug ? 'status-active' : 'status-not_connected'}`} href={`/admin/seo/internal-links?site=${s.slug}`}>{s.shortName}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <Link className={`status-badge ${!reason ? 'status-active' : 'status-not_connected'}`} href={`/admin/seo/internal-links${siteSlug ? `?site=${siteSlug}` : ''}`}>All reasons</Link>
          {['authority_handoff', 'query_cluster_missing_link', 'orphan_gsc'].map((r) => (
            <Link key={r} className={`status-badge ${reason === r ? 'status-active' : 'status-not_connected'}`} href={`/admin/seo/internal-links?${siteSlug ? `site=${siteSlug}&` : ''}reason=${r}`}>{r.replace(/_/g, ' ')}</Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel title="Nothing to show" eyebrow="Opportunities">
          <EmptyState title="No internal-link opportunities." description="Trigger /api/sync/internal-links after a GSC sync to populate." tone="muted" />
        </Panel>
      ) : (
        <Panel title={`${rows.length} opportunit${rows.length === 1 ? 'y' : 'ies'}`} eyebrow="Opportunities">
          <Table<Row>
            columns={[
              { key: 'reason',   header: 'Reason',  render: (r) => <StatusBadge state={r.priority} label={r.reason.replace(/_/g, ' ')} /> },
              { key: 'site',     header: 'Site',    render: (r) => <span className="col-dim">{sitesById.get(r.site_id)?.shortName ?? ''}</span> },
              { key: 'link',     header: 'Link',    render: (r) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 520 }}>
                  <div style={{ fontSize: 12 }}><strong>From</strong> <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source_url}</a></div>
                  <div style={{ fontSize: 12 }}><strong>To</strong> <a href={r.target_url} target="_blank" rel="noopener noreferrer">{r.target_url}</a></div>
                  <span className="col-dim" style={{ fontSize: 11 }}>{r.relationship ?? ''} · confidence {r.confidence}</span>
                </div>
              ) },
              { key: 'evidence', header: 'Evidence', render: (r) => (
                <code style={{ fontSize: 11, display: 'block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(r.evidence).slice(0, 200)}
                </code>
              ) },
              { key: 'actions',  header: '', render: (r) => <InternalLinkActions opportunityId={r.id} status={r.status} taskId={r.task_id} /> },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
