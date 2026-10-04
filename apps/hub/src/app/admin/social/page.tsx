import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, MetricCard, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt, formatRelative } from '@/lib/format';
import { RegenerateSocialIdeasButton } from './SocialActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

interface TodayPost {
  id: string; account_id: string; text: string; status: string; post_type: string;
  scheduled_for: string | null; parent_post_id: string | null; thread_position: number;
  network_social_accounts: { handle: string; display_name: string };
}

export default async function SocialDashboard() {
  const { admin, sb } = await requireAdmin('/admin/social');
  const sites = await listNetworkSites(sb);

  const [
    { data: accounts },
    { count: openIdeas }, { count: draftPosts }, { count: reviewPosts },
    { count: approvedPosts }, { count: scheduledPosts }, { count: publishedPosts },
    { data: todayPosts }, { data: ideasPreview },
    { data: costSum },
  ] = await Promise.all([
    sb.from('network_social_accounts').select('id, platform, handle, display_name, oauth_state, is_primary, last_post_at').eq('status', 'active'),
    sb.from('network_social_ideas').select('*', { count: 'exact', head: true }).eq('status', 'new'),
    sb.from('network_social_posts').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
    sb.from('network_social_posts').select('*', { count: 'exact', head: true }).eq('status', 'review'),
    sb.from('network_social_posts').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
    sb.from('network_social_posts').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
    sb.from('network_social_posts').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    sb.from('network_social_posts')
      .select('id, account_id, text, status, post_type, scheduled_for, parent_post_id, thread_position, network_social_accounts(handle, display_name)')
      .in('status', ['draft', 'review', 'approved']).is('parent_post_id', null)
      .order('updated_at', { ascending: false }).limit(5),
    sb.from('network_social_ideas')
      .select('id, working_title, priority, origin_type, summary')
      .eq('status', 'new').order('priority', { ascending: true }).limit(5),
    sb.from('network_ai_cost_log').select('operation, est_cost_usd, input_tokens, output_tokens').gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).in('operation', ['social_draft', 'thread_draft', 'editorial_qc', 'newsletter_draft', 'refresh_brief']),
  ]);

  const today = (todayPosts ?? []) as unknown as TodayPost[];
  const ideas = (ideasPreview ?? []) as Array<{ id: string; working_title: string; priority: string; origin_type: string; summary: string | null }>;
  const costRows = ((costSum ?? []) as Array<{ operation: string; est_cost_usd: number; input_tokens: number; output_tokens: number }>);
  const costTotal = costRows.reduce((a, r) => a + Number(r.est_cost_usd ?? 0), 0);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/social">
      <SectionHeader
        eyebrow="Social"
        title="Today"
        description="Approve-only workflow. AI drafts live posts from evidence (articles, movers, brief). Nothing publishes publicly without explicit sign-off. Current primary account: Luke | Collector Network (X)."
        actions={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Link className="status-badge status-opportunity" href="/admin/social/ideas">Ideas →</Link>
            <Link className="status-badge status-active" href="/admin/social/posts">Posts →</Link>
            <Link className="status-badge status-active" href="/admin/social/calendar">Calendar →</Link>
            <Link className="status-badge status-active" href="/admin/social/new">New post →</Link>
          </div>
        }
      />

      <div className="metric-grid">
        <MetricCard label="Ideas · new" value={formatInt(openIdeas ?? 0)} helper="awaiting draft" />
        <MetricCard label="Posts · draft" value={formatInt(draftPosts ?? 0)} />
        <MetricCard label="Posts · review" value={formatInt(reviewPosts ?? 0)} />
        <MetricCard label="Posts · approved" value={formatInt(approvedPosts ?? 0)} helper="ready to publish" />
        <MetricCard label="Posts · scheduled" value={formatInt(scheduledPosts ?? 0)} />
        <MetricCard label="Posts · published" value={formatInt(publishedPosts ?? 0)} />
      </div>

      <Panel title="Today — posts needing attention" eyebrow={`Up to 5 shown`} actions={<RegenerateSocialIdeasButton />}>
        {today.length === 0 ? (
          <EmptyState title="Nothing in the queue." description="Click 'Ideas →' to view evidence-backed candidates, or 'New post →' for a manual draft." tone="muted" />
        ) : (
          <Table<TodayPost>
            columns={[
              { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'approved' ? 'approved' : r.status === 'review' ? 'pending' : 'info'} label={r.status} /> },
              { key: 'acct', header: 'Account', render: (r) => `${r.network_social_accounts?.display_name ?? ''} (@${r.network_social_accounts?.handle ?? ''})` },
              { key: 'text', header: 'Text', render: (r) => (
                <div style={{ maxWidth: 500 }}>
                  <Link href={`/admin/social/posts/${r.id}`} style={{ fontWeight: 600 }}>{r.text.slice(0, 180)}{r.text.length > 180 ? '…' : ''}</Link>
                  <div className="col-dim" style={{ fontSize: 11 }}>{r.post_type.replace(/_/g, ' ')} · {r.text.length} chars</div>
                </div>
              ) },
              { key: 'sched', header: 'Scheduled', render: (r) => r.scheduled_for ? new Date(r.scheduled_for).toISOString().slice(0, 16).replace('T', ' ') : <span className="col-dim">—</span> },
            ]}
            rows={today}
          />
        )}
      </Panel>

      <Panel title="Idea queue (preview)" eyebrow="Candidates">
        {ideas.length === 0 ? (
          <EmptyState title="No new ideas." description="Click 'Regenerate from evidence' above (or in /admin/social/ideas) to scan articles, brief, and market movers." tone="muted" />
        ) : (
          <Table
            columns={[
              { key: 'pri', header: 'Priority', render: (r: typeof ideas[number]) => <StatusBadge state={r.priority as 'critical' | 'high' | 'normal' | 'low'} /> },
              { key: 'title', header: 'Working title', render: (r) => <Link href="/admin/social/ideas" style={{ fontWeight: 600 }}>{r.working_title}</Link> },
              { key: 'origin', header: 'Origin', render: (r) => <StatusBadge state="info" label={r.origin_type.replace(/_/g, ' ')} /> },
              { key: 'summary', header: 'Why', render: (r) => <span style={{ fontSize: 12 }} className="col-dim">{r.summary?.slice(0, 180) ?? ''}</span> },
            ]}
            rows={ideas}
          />
        )}
      </Panel>

      <Panel title="Accounts" eyebrow="Platforms">
        <Table
          columns={[
            { key: 'handle', header: 'Account', render: (r: { id: string; platform: string; handle: string; display_name: string; oauth_state: string; is_primary: boolean; last_post_at: string | null }) => (
              <div>
                <strong>{r.display_name}</strong> <span className="col-dim">@{r.handle}</span>
                {r.is_primary && <span className="status-badge status-active" style={{ fontSize: 10, marginLeft: 8 }}>primary</span>}
              </div>
            )},
            { key: 'platform', header: 'Platform', render: (r) => r.platform.toUpperCase() },
            { key: 'oauth', header: 'OAuth', render: (r) => <StatusBadge state={r.oauth_state === 'connected' ? 'connected' : 'not_connected'} label={r.oauth_state.replace(/_/g, ' ')} /> },
            { key: 'last', header: 'Last post', render: (r) => r.last_post_at ? formatRelative(r.last_post_at) : <span className="col-dim">never</span> },
          ]}
          rows={((accounts ?? []) as unknown as Array<{ id: string; platform: string; handle: string; display_name: string; oauth_state: string; is_primary: boolean; last_post_at: string | null }>)}
        />
      </Panel>

      <Panel title="AI social cost (last 7d)" eyebrow="Operations">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="Est cost (USD)" value={`$${costTotal.toFixed(4)}`} state={costTotal > 0 ? 'ok' : 'muted'} />
          <MetricCard label="Operations" value={formatInt(costRows.length)} />
          <MetricCard label="Input tokens" value={formatInt(costRows.reduce((a, r) => a + Number(r.input_tokens ?? 0), 0))} />
          <MetricCard label="Output tokens" value={formatInt(costRows.reduce((a, r) => a + Number(r.output_tokens ?? 0), 0))} />
        </div>
      </Panel>
    </AdminShell>
  );
}
