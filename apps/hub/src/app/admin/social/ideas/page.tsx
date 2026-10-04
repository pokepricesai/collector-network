import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';
import { IdeaRowActions, RegenerateSocialIdeasButton } from '../SocialActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

interface IdeaRow {
  id: string; account_id: string; working_title: string; summary: string | null;
  post_type: string; priority: 'critical' | 'high' | 'normal' | 'low';
  status: string; origin_type: string; evidence: Record<string, unknown>;
  last_seen_at: string;
}

export default async function SocialIdeasPage() {
  const { admin, sb } = await requireAdmin('/admin/social/ideas');
  const sites = await listNetworkSites(sb);

  const { data } = await sb.from('network_social_ideas')
    .select('id, account_id, working_title, summary, post_type, priority, status, origin_type, evidence, last_seen_at')
    .eq('status', 'new').order('priority', { ascending: true }).order('last_seen_at', { ascending: false }).limit(200);
  const rows = (data ?? []) as unknown as IdeaRow[];

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/social/ideas">
      <SectionHeader
        eyebrow="Social · Ideas"
        title="Social post ideas"
        description="Evidence-backed candidates. Deterministic engine — AI drafts only when there's a legitimate reason to post. Articles, movers, brief notables, and manual entries all live here."
        actions={<RegenerateSocialIdeasButton />}
      />
      {rows.length === 0 ? (
        <Panel title="No new ideas" eyebrow="Candidates">
          <EmptyState title="Nothing to draft." description="Click 'Regenerate from evidence' to scan recent articles, pricing movers, and the daily brief. Idea generation stays sparse by design — not every signal becomes a post." tone="muted" />
        </Panel>
      ) : (
        <Panel title={`${rows.length} idea${rows.length === 1 ? '' : 's'}`} eyebrow="Candidates">
          <Table<IdeaRow>
            columns={[
              { key: 'pri', header: 'Priority', render: (r) => <StatusBadge state={r.priority} /> },
              { key: 'title', header: 'Working title', render: (r) => (
                <div style={{ maxWidth: 500 }}>
                  <strong style={{ fontSize: 13 }}>{r.working_title}</strong>
                  {r.summary && <div className="col-dim" style={{ fontSize: 11 }}>{r.summary.slice(0, 180)}</div>}
                  <div className="col-dim" style={{ fontSize: 11 }}>{r.post_type.replace(/_/g, ' ')} · origin: {r.origin_type}</div>
                </div>
              ) },
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
