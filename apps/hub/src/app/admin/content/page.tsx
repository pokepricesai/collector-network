import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { MetricCard, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt, formatPct, formatRelative } from '@/lib/format';
import { computeArticlePerformance } from '@/server/content/performance';
import { RefreshIdeasButton } from './RefreshIdeasButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

interface ArticleRow {
  id: string; site_id: string; title: string; slug: string; status: string;
  content_type: string; publication_target: string; publication_url: string | null;
  updated_at: string; published_at: string | null;
}

export default async function ContentDashboard() {
  const { admin, sb } = await requireAdmin('/admin/content');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const [
    { count: ideasNew }, { count: briefsInReview },
    { count: articlesDraft }, { count: articlesReview }, { count: articlesApproved },
    { count: articlesScheduled }, { count: articlesPublished }, { count: articlesFailed },
    { data: recentPub }, { data: approvalBacklog }, { data: aiCostTotals },
  ] = await Promise.all([
    sb.from('network_content_ideas').select('*', { count: 'exact', head: true }).eq('status', 'new'),
    sb.from('network_content_briefs').select('*', { count: 'exact', head: true }).eq('status', 'in_review'),
    sb.from('network_articles').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
    sb.from('network_articles').select('*', { count: 'exact', head: true }).eq('status', 'review'),
    sb.from('network_articles').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
    sb.from('network_articles').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
    sb.from('network_articles').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    sb.from('network_articles').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    sb.from('network_articles')
      .select('id, site_id, title, slug, status, content_type, publication_target, publication_url, updated_at, published_at')
      .in('status', ['draft', 'review', 'approved', 'scheduled', 'published'])
      .order('updated_at', { ascending: false }).limit(15),
    sb.from('network_approvals').select('id, title, action_type, created_at, site_id').eq('status', 'pending').in('action_type', ['content_brief', 'content_publish']).order('created_at', { ascending: false }).limit(10),
    sb.from('network_ai_cost_log').select('operation, est_cost_usd, input_tokens, output_tokens').gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  const costSum = ((aiCostTotals ?? []) as Array<{ operation: string; est_cost_usd: number; input_tokens: number; output_tokens: number }>);
  const costTotal = costSum.reduce((a, r) => a + Number(r.est_cost_usd ?? 0), 0);
  const inTokens = costSum.reduce((a, r) => a + Number(r.input_tokens ?? 0), 0);
  const outTokens = costSum.reduce((a, r) => a + Number(r.output_tokens ?? 0), 0);

  const articles = (recentPub ?? []) as ArticleRow[];
  const approvals = ((approvalBacklog ?? []) as Array<{ id: string; title: string; action_type: string; created_at: string; site_id: string | null }>);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content">
      <SectionHeader
        eyebrow="Content"
        title="Content workflow"
        description="Phase 2 opportunity → brief → draft → review → approved → published. Approval is explicit at every gate; AI never auto-publishes."
        actions={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Link className="status-badge status-opportunity" href="/admin/content/ideas">Ideas →</Link>
            <Link className="status-badge status-active" href="/admin/content/briefs">Briefs →</Link>
            <Link className="status-badge status-active" href="/admin/content/articles">Articles →</Link>
            <Link className="status-badge status-active" href="/admin/content/calendar">Calendar →</Link>
            <Link className="status-badge status-info" href="/admin/content/autopilot">Autopilot →</Link>
            <Link className="status-badge status-warning" href="/admin/content/holds">Holds →</Link>
          </div>
        }
      />

      <div className="metric-grid">
        <MetricCard label="Ideas · new" value={formatInt(ideasNew ?? 0)} helper="awaiting brief" />
        <MetricCard label="Briefs · in review" value={formatInt(briefsInReview ?? 0)} helper="awaiting approval" />
        <MetricCard label="Articles · draft" value={formatInt(articlesDraft ?? 0)} />
        <MetricCard label="Articles · review" value={formatInt(articlesReview ?? 0)} />
        <MetricCard label="Articles · approved" value={formatInt(articlesApproved ?? 0)} helper="ready to publish" />
        <MetricCard label="Articles · scheduled" value={formatInt(articlesScheduled ?? 0)} />
        <MetricCard label="Articles · published" value={formatInt(articlesPublished ?? 0)} />
        <MetricCard label="Articles · failed" value={formatInt(articlesFailed ?? 0)} state="muted" />
      </div>

      <Panel title="Approval backlog" eyebrow="Content approvals">
        {approvals.length === 0 ? (
          <div className="admin-empty admin-empty--muted"><div className="admin-empty-title">Nothing waiting on approval.</div></div>
        ) : (
          <Table
            columns={[
              { key: 'kind', header: 'Kind', render: (r: typeof approvals[number]) => <StatusBadge state="info" label={r.action_type.replace(/_/g, ' ')} /> },
              { key: 'site', header: 'Site', render: (r) => sitesById.get(r.site_id ?? '')?.shortName ?? '—' },
              { key: 'title', header: 'Title', render: (r) => r.title },
              { key: 'when', header: 'Opened', render: (r) => formatRelative(r.created_at) },
              { key: 'go', header: '', render: () => <Link className="status-badge status-opportunity" href="/admin/approvals">Review →</Link> },
            ]}
            rows={approvals}
          />
        )}
      </Panel>

      <Panel title="Recent articles" eyebrow="Pipeline">
        {articles.length === 0 ? (
          <div className="admin-empty admin-empty--muted"><div className="admin-empty-title">No articles in the pipeline yet.</div></div>
        ) : (
          <Table<ArticleRow>
            columns={[
              { key: 't', header: 'Title', render: (a) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 460 }}>
                  <Link href={`/admin/content/articles/${a.id}`} style={{ fontWeight: 600 }}>{a.title}</Link>
                  <span className="col-dim" style={{ fontSize: 11 }}>{a.content_type.replace(/_/g, ' ')} · <code>{a.slug}</code></span>
                </div>
              ) },
              { key: 'site', header: 'Site', render: (a) => sitesById.get(a.site_id)?.shortName ?? '' },
              { key: 'status', header: 'Status', render: (a) => <StatusBadge state={a.status === 'published' ? 'success' : a.status === 'approved' ? 'approved' : a.status === 'review' ? 'pending' : 'info'} label={a.status} /> },
              { key: 'target', header: 'Target', render: (a) => <code style={{ fontSize: 11 }}>{a.publication_target.replace(/_/g, '·')}</code> },
              { key: 'updated', header: 'Updated', render: (a) => formatRelative(a.updated_at) },
            ]}
            rows={articles}
          />
        )}
      </Panel>

      <Panel title="Article performance" eyebrow="GSC 28d vs prior 28d · ending at latest observed date per site" actions={<RefreshIdeasButton />}>
        <ArticlePerformanceGrid />
      </Panel>

      <Panel title="AI cost (last 7d)" eyebrow="Generation">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="Est cost (USD)" value={`$${costTotal.toFixed(4)}`} state={costTotal > 0 ? 'ok' : 'muted'} />
          <MetricCard label="Input tokens" value={formatInt(inTokens)} />
          <MetricCard label="Output tokens" value={formatInt(outTokens)} />
          <MetricCard label="Operations" value={formatInt(costSum.length)} />
        </div>
      </Panel>
    </AdminShell>
  );
}

async function ArticlePerformanceGrid() {
  const perf = await (async () => { const { createServiceRoleSupabase } = await import('@/server/admin/service-role'); return computeArticlePerformance(createServiceRoleSupabase()); })();
  function row(r: { article_id: string; site_slug: string; title: string; current_28d_clicks: number; current_28d_impressions: number; ctr_28d: number | null; position_28d: number | null; pct_change_clicks: number | null }) {
    return (
      <li key={r.article_id} style={{ padding: '6px 0', borderBottom: '1px solid #F0F0F0', fontSize: 12 }}>
        <Link href={`/admin/content/articles/${r.article_id}`} style={{ fontWeight: 600 }}>{r.title.slice(0, 80)}</Link>
        <div className="col-dim">{r.site_slug} · {formatInt(r.current_28d_clicks)} clicks · {formatInt(r.current_28d_impressions)} impr{r.ctr_28d != null ? ` · CTR ${formatPct(r.ctr_28d)}` : ''}{r.position_28d != null ? ` · pos ${r.position_28d.toFixed(1)}` : ''}{r.pct_change_clicks != null ? ` · Δ ${(r.pct_change_clicks * 100).toFixed(0)}%` : ''}</div>
      </li>
    );
  }
  function panel(title: string, items: typeof perf.top_performing, emptyNote: string) {
    return (
      <div style={{ border: '1px solid #E6E6E6', borderRadius: 6, padding: 10 }}>
        <h4 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>{title} ({items.length})</h4>
        {items.length === 0 ? <span className="col-dim" style={{ fontSize: 12 }}>{emptyNote}</span>
          : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{items.map(row)}</ul>}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
      {panel('Top performing (28d clicks)', perf.top_performing, 'No published articles with GSC data yet.')}
      {panel('Gaining (≥30% clicks vs prior)', perf.gaining, 'No gainers in this window.')}
      {panel('Declining (≥30% drop)', perf.declining, 'No declines in this window.')}
      {panel('Zero impressions (>14d since publish)', perf.zero_impression, 'Nothing with zero impressions.')}
      {panel('Refresh candidates', perf.refresh_candidates, 'No articles in striking distance or low-CTR territory.')}
    </div>
  );
}
