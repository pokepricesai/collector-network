import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ status?: string; site?: string }> }

interface BriefRow {
  id: string; idea_id: string; site_id: string; content_type: string;
  payload: { suggested_h1?: string; purpose?: string; primary_query?: string };
  status: 'draft' | 'in_review' | 'approved' | 'rejected';
  actor_type: 'human' | 'system' | 'ai';
  ai_model: string | null; ai_est_cost_usd: number | null;
  generated_at: string;
}

export default async function BriefsPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/content/briefs');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const status = sp.status ?? 'in_review';
  const siteSlug = sp.site && sp.site !== 'network' ? sp.site : null;
  const siteId = siteSlug ? sites.find((s) => s.slug === siteSlug)?.id ?? null : null;

  let q = sb.from('network_content_briefs')
    .select('id, idea_id, site_id, content_type, payload, status, actor_type, ai_model, ai_est_cost_usd, generated_at')
    .order('generated_at', { ascending: false })
    .limit(100);
  if (siteId) q = q.eq('site_id', siteId);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as BriefRow[];
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={siteSlug ?? 'network'} pathname="/admin/content/briefs">
      <SectionHeader
        eyebrow="Content · Briefs"
        title="Briefs"
        description="AI-assisted briefs generated from Phase 2 evidence. Each brief lives in approval state until the editor accepts or rejects it. Approved briefs can become article drafts."
      />
      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['draft', 'in_review', 'approved', 'rejected'] as const).map((s) => (
            <Link key={s} className={`status-badge ${status === s ? 'status-active' : 'status-not_connected'}`} href={`/admin/content/briefs?${siteSlug ? `site=${siteSlug}&` : ''}status=${s}`}>{s.replace(/_/g, ' ')}</Link>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <Panel title="No briefs" eyebrow="Pipeline">
          <EmptyState title="Nothing yet." description="Open an idea and click 'Generate brief' to produce one." tone="muted" />
        </Panel>
      ) : (
        <Panel title={`${rows.length} brief${rows.length === 1 ? '' : 's'}`} eyebrow="Pipeline">
          <Table<BriefRow>
            columns={[
              { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'} label={r.status.replace(/_/g, ' ')} /> },
              { key: 'site', header: 'Site', render: (r) => sitesById.get(r.site_id)?.shortName ?? '' },
              { key: 'title', header: 'Suggested H1', render: (r) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 500 }}>
                  <Link href={`/admin/content/briefs/${r.id}`} style={{ fontWeight: 600 }}>{r.payload?.suggested_h1 ?? '(no H1)'}</Link>
                  {r.payload?.purpose && <span className="col-dim" style={{ fontSize: 11 }}>{r.payload.purpose.slice(0, 200)}</span>}
                  <span className="col-dim" style={{ fontSize: 11 }}>{r.content_type.replace(/_/g, ' ')}{r.payload?.primary_query ? ` · "${r.payload.primary_query}"` : ''}</span>
                </div>
              ) },
              { key: 'ai', header: 'AI', render: (r) => (
                r.actor_type === 'ai' ? <span className="col-dim" style={{ fontSize: 11 }}>{r.ai_model ?? ''}{r.ai_est_cost_usd ? ` · $${Number(r.ai_est_cost_usd).toFixed(4)}` : ''}</span> : <span className="col-dim">human</span>
              ) },
              { key: 'when', header: 'Generated', render: (r) => formatRelative(r.generated_at) },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
