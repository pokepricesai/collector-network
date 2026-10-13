import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { MetricCard, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt, formatPct, formatRelative } from '@/lib/format';
import { siteDisplayName } from '@/lib/display-names';
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

  // Identify the bottleneck + next action for the top-line summary.
  const pipeline = { ideas: ideasNew ?? 0, briefs: briefsInReview ?? 0, draft: articlesDraft ?? 0, review: articlesReview ?? 0, approved: articlesApproved ?? 0, scheduled: articlesScheduled ?? 0, published: articlesPublished ?? 0, failed: articlesFailed ?? 0 };
  const bottleneck =
    pipeline.review > 0   ? { label: `${pipeline.review} article${pipeline.review === 1 ? '' : 's'} awaiting review`, href: '/admin/content/articles?status=review' }
    : pipeline.approved > 0 ? { label: `${pipeline.approved} approved · ready to publish`, href: '/admin/content/articles?status=approved' }
    : pipeline.briefs > 0 ? { label: `${pipeline.briefs} brief${pipeline.briefs === 1 ? '' : 's'} in review`, href: '/admin/content/briefs' }
    : pipeline.ideas > 0  ? { label: `${pipeline.ideas} idea${pipeline.ideas === 1 ? '' : 's'} awaiting brief`, href: '/admin/content/ideas' }
    : null;
  const nextArticle = articles.find((a) => a.status === 'scheduled') ?? articles.find((a) => a.status === 'review') ?? articles.find((a) => a.status === 'approved');
  const latestPublished = articles.find((a) => a.status === 'published');

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content">
      <SectionHeader
        eyebrow="Growth · Content"
        title="Content Engine"
        description={bottleneck
          ? <>Approve-only workflow: opportunity → brief → draft → review → approved → published. Current bottleneck: <Link href={bottleneck.href}><strong>{bottleneck.label}</strong></Link>.</>
          : 'Approve-only workflow: opportunity → brief → draft → review → approved → published. Nothing publishes without explicit sign-off.'
        }
        actions={
          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/ideas">Ideas</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/briefs">Briefs</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/articles">Articles</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/calendar">Calendar</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/autopilot">Autopilot</Link>
          </div>
        }
      />

      <Panel title="Pipeline" eyebrow="Active work only">
        {/* Compressed counters — hide zero cards so the panel reflects
            actual work in flight, not the full state machine. */}
        <div className="metric-grid metric-grid--compact">
          {pipeline.ideas > 0    && <MetricCard label="Ideas · new"        value={formatInt(pipeline.ideas)}    helper="awaiting brief" />}
          {pipeline.briefs > 0   && <MetricCard label="Briefs · in review" value={formatInt(pipeline.briefs)}   helper="awaiting approval" />}
          {pipeline.draft > 0    && <MetricCard label="Articles · draft"   value={formatInt(pipeline.draft)} />}
          {pipeline.review > 0   && <MetricCard label="Articles · review"  value={formatInt(pipeline.review)} />}
          {pipeline.approved > 0 && <MetricCard label="Articles · approved" value={formatInt(pipeline.approved)} helper="ready to publish" />}
          {pipeline.scheduled > 0 && <MetricCard label="Articles · scheduled" value={formatInt(pipeline.scheduled)} />}
          {pipeline.failed > 0   && <MetricCard label="Articles · failed" value={formatInt(pipeline.failed)} state="muted" />}
          {Object.values(pipeline).every((v) => v === 0 || v === pipeline.published) && (
            <MetricCard label="Pipeline" value="Empty" state="muted" helper="No work in flight" />
          )}
          <MetricCard label="Published (total)" value={formatInt(pipeline.published)} state="muted" />
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--admin-text-muted)', lineHeight: 1.5 }}>
          {nextArticle && <div><strong>Next up:</strong> <Link href={`/admin/content/articles/${nextArticle.id}`}>{nextArticle.title}</Link> · {nextArticle.status}</div>}
          {latestPublished && <div><strong>Last published:</strong> {latestPublished.title}{latestPublished.published_at && ` · ${latestPublished.published_at.slice(0, 10)}`}</div>}
          {!nextArticle && !latestPublished && <span>No articles yet.</span>}
        </div>
      </Panel>

      {approvals.length > 0 && (
        <Panel title="Approval backlog" eyebrow={`${approvals.length} pending`}>
          <Table
            columns={[
              { key: 'kind', header: 'Kind', render: (r: typeof approvals[number]) => <StatusBadge state="info" label={r.action_type.replace(/_/g, ' ')} /> },
              { key: 'site', header: 'Site', render: (r) => siteDisplayName(sitesById.get(r.site_id ?? '')?.slug, 'Network') },
              { key: 'title', header: 'Title', render: (r) => r.title },
              { key: 'when', header: 'Opened', render: (r) => formatRelative(r.created_at) },
              { key: 'go', header: '', render: () => <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/approvals">Review</Link> },
            ]}
            rows={approvals}
          />
        </Panel>
      )}

      <Panel title="Recent articles" eyebrow="Pipeline">
        {articles.length === 0 ? (
          <EmptyPanelNotice>No articles in the pipeline yet.</EmptyPanelNotice>
        ) : (
          <Table<ArticleRow>
            columns={[
              { key: 't', header: 'Title', render: (a) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 460 }}>
                  <Link href={`/admin/content/articles/${a.id}`} style={{ fontWeight: 600, textDecoration: 'none', color: 'inherit' }}>{a.title}</Link>
                  <span className="col-dim" style={{ fontSize: 11 }}>{a.content_type.replace(/_/g, ' ')}</span>
                </div>
              ) },
              { key: 'site', header: 'Site', render: (a) => siteDisplayName(sitesById.get(a.site_id)?.slug, 'Network') },
              { key: 'status', header: 'Status', render: (a) => <StatusBadge state={a.status === 'published' ? 'success' : a.status === 'approved' ? 'approved' : a.status === 'review' ? 'pending' : 'info'} label={a.status} /> },
              { key: 'when', header: 'State', render: (a) => (
                <span style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>
                  {a.published_at ? `published ${a.published_at.slice(0, 10)}` : `updated ${formatRelative(a.updated_at)}`}
                </span>
              ) },
            ]}
            rows={articles}
          />
        )}
      </Panel>

      <Panel title="Article performance" eyebrow="GSC 28d vs prior 28d" actions={<RefreshIdeasButton />}>
        <ArticlePerformanceGrid />
      </Panel>

      <Panel title="AI cost (last 7d)" eyebrow="Generation spend">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="Est cost (USD)" value={`$${costTotal.toFixed(4)}`} state={costTotal > 0 ? 'ok' : 'muted'} helper="all operations" />
          <MetricCard label="Operations" value={formatInt(costSum.length)} />
          <MetricCard label="Avg cost / op" value={costSum.length > 0 ? `$${(costTotal / costSum.length).toFixed(5)}` : '—'} />
        </div>
        <details style={{ marginTop: 10, fontSize: 11, color: 'var(--admin-text-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>Token detail</summary>
          <div style={{ marginTop: 6, display: 'flex', gap: 14 }}>
            <div><strong>Input tokens:</strong> {formatInt(inTokens)}</div>
            <div><strong>Output tokens:</strong> {formatInt(outTokens)}</div>
          </div>
        </details>
      </Panel>
    </AdminShell>
  );
}

async function ArticlePerformanceGrid() {
  const perf = await (async () => { const { createServiceRoleSupabase } = await import('@/server/admin/service-role'); return computeArticlePerformance(createServiceRoleSupabase()); })();
  const anyData = [perf.top_performing, perf.gaining, perf.declining, perf.zero_impression, perf.refresh_candidates].some((x) => x.length > 0);
  if (!anyData) {
    return <EmptyPanelNotice>No published-article performance data yet. Metrics appear once GSC rows exist for published URLs.</EmptyPanelNotice>;
  }
  function row(r: { article_id: string; site_slug: string; title: string; current_28d_clicks: number; current_28d_impressions: number; ctr_28d: number | null; position_28d: number | null; pct_change_clicks: number | null }) {
    return (
      <li key={r.article_id} style={{ padding: '6px 0', borderBottom: '1px solid var(--admin-border)', fontSize: 12 }}>
        <Link href={`/admin/content/articles/${r.article_id}`} style={{ fontWeight: 600 }}>{r.title.slice(0, 80)}</Link>
        <div className="col-dim">{siteDisplayName(r.site_slug, 'Network')} · {formatInt(r.current_28d_clicks)} clicks · {formatInt(r.current_28d_impressions)} impr{r.ctr_28d != null ? ` · CTR ${formatPct(r.ctr_28d)}` : ''}{r.position_28d != null ? ` · pos ${r.position_28d.toFixed(1)}` : ''}{r.pct_change_clicks != null ? ` · Δ ${(r.pct_change_clicks * 100).toFixed(0)}%` : ''}</div>
      </li>
    );
  }
  function panel(title: string, items: typeof perf.top_performing) {
    if (items.length === 0) return null;
    return (
      <div style={{ border: '1px solid var(--admin-border)', borderRadius: 6, padding: 10 }}>
        <h4 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>{title} ({items.length})</h4>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{items.map(row)}</ul>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
      {panel('Top performing (28d clicks)', perf.top_performing)}
      {panel('Gaining (≥30% vs prior)', perf.gaining)}
      {panel('Declining (≥30% drop)', perf.declining)}
      {panel('Zero impressions (>14d since publish)', perf.zero_impression)}
      {panel('Refresh candidates', perf.refresh_candidates)}
    </div>
  );
}
