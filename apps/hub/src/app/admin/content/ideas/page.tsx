import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt, formatRelative } from '@/lib/format';
import { IdeaRowActions, RegenerateIdeasButton } from './IdeaActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ site?: string; status?: string }> }

interface IdeaRow {
  id: string; site_id: string; content_type: string;
  working_title: string; primary_query: string | null;
  secondary_queries: string[]; summary: string | null;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'new' | 'in_brief' | 'drafting' | 'published' | 'dismissed' | 'stale';
  origin_type: string; evidence: Record<string, unknown>;
  created_at: string; last_seen_at: string;
}

export default async function IdeasPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/content/ideas');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const siteSlug = sp.site && sp.site !== 'network' ? sp.site : null;
  const status = sp.status ?? 'new';
  const siteId = siteSlug ? sites.find((s) => s.slug === siteSlug)?.id ?? null : null;

  let q = sb.from('network_content_ideas')
    .select('id, site_id, content_type, working_title, primary_query, secondary_queries, summary, priority, status, origin_type, evidence, created_at, last_seen_at')
    .order('priority', { ascending: true })
    .order('last_seen_at', { ascending: false })
    .limit(300);
  if (siteId) q = q.eq('site_id', siteId);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as IdeaRow[];
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={siteSlug ?? 'network'} pathname="/admin/content/ideas">
      <SectionHeader
        eyebrow="Content · Ideas"
        title="Content ideas"
        description="Evidence-backed content ideas generated deterministically from Phase 2 outputs. Dedup on (site, origin). Click 'Generate brief' to invoke the AI brief generator against structured evidence."
        actions={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <RegenerateIdeasButton />
            <Link className="status-badge status-active" href="/admin/content/ideas/new">New idea →</Link>
          </div>
        }
      />

      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!siteSlug ? 'status-active' : 'status-not_connected'}`} href={`/admin/content/ideas${status !== 'new' ? `?status=${status}` : ''}`}>Network</Link>
          {sites.map((s) => (
            <Link key={s.slug} className={`status-badge ${siteSlug === s.slug ? 'status-active' : 'status-not_connected'}`} href={`/admin/content/ideas?site=${s.slug}${status !== 'new' ? `&status=${status}` : ''}`}>{s.shortName}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {(['new', 'in_brief', 'drafting', 'published', 'dismissed', 'stale'] as const).map((s) => (
            <Link key={s} className={`status-badge ${status === s ? 'status-active' : 'status-not_connected'}`} href={`/admin/content/ideas?${siteSlug ? `site=${siteSlug}&` : ''}status=${s}`}>{s.replace(/_/g, ' ')}</Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel title={`${status} ideas`} eyebrow="Pipeline">
          <EmptyState title="Nothing here." description="Click 'Regenerate from Phase 2' above to populate ideas from existing opportunities + page_opportunities + content_gaps + cannibalisation findings." tone="muted" />
        </Panel>
      ) : (
        <Panel title={`${rows.length} idea${rows.length === 1 ? '' : 's'}`} eyebrow="Pipeline">
          <Table<IdeaRow>
            columns={[
              { key: 'pri', header: 'Priority', render: (r) => <StatusBadge state={r.priority} /> },
              { key: 'site', header: 'Site', render: (r) => sitesById.get(r.site_id)?.shortName ?? '' },
              { key: 'title', header: 'Working title', render: (r) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 500 }}>
                  <strong style={{ fontSize: 13 }}>{r.working_title}</strong>
                  {r.summary && <span style={{ fontSize: 11 }} className="col-dim">{r.summary.slice(0, 200)}</span>}
                  <span className="col-dim" style={{ fontSize: 11 }}>{r.content_type.replace(/_/g, ' ')} · origin: {r.origin_type}{r.primary_query ? ` · "${r.primary_query}"` : ''}</span>
                </div>
              ) },
              { key: 'evidence', header: 'Evidence', render: (r) => {
                const e = r.evidence as Record<string, unknown>;
                const impr = e['impressions_28d'] ?? (e['metrics'] as Record<string, unknown> | undefined)?.['impressions_28d'];
                const parts: string[] = [];
                if (typeof impr === 'number') parts.push(`${formatInt(impr)} impr/28d`);
                if (typeof e['url_count'] === 'number') parts.push(`${e['url_count']} URLs`);
                if (typeof e['position_28d'] === 'number') parts.push(`pos ${(e['position_28d'] as number).toFixed(1)}`);
                return <span className="col-dim" style={{ fontSize: 11 }}>{parts.join(' · ') || '—'}</span>;
              } },
              { key: 'seen', header: 'Last seen', render: (r) => formatRelative(r.last_seen_at) },
              { key: 'actions', header: '', render: (r) => <IdeaRowActions ideaId={r.id} status={r.status} /> },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
