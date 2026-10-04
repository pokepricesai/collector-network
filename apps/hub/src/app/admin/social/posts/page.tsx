import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ status?: string }> }
interface PostRow {
  id: string; account_id: string; text: string; status: string; post_type: string;
  scheduled_for: string | null; updated_at: string;
  parent_post_id: string | null; thread_position: number;
  external_url: string | null;
  network_social_accounts: { handle: string; display_name: string };
}

export default async function SocialPostsPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/social/posts');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const status = sp.status ?? null;

  let q = sb.from('network_social_posts')
    .select('id, account_id, text, status, post_type, scheduled_for, updated_at, parent_post_id, thread_position, external_url, network_social_accounts(handle, display_name)')
    .is('parent_post_id', null)
    .order('updated_at', { ascending: false }).limit(200);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as PostRow[];

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/social/posts">
      <SectionHeader
        eyebrow="Social · Posts"
        title="Posts"
        description="Every planned social post. Threads collapse to their parent; click into a post to see the full thread + edit + approve + publish."
      />
      <div className="admin-filter-bar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link className={`status-badge ${!status ? 'status-active' : 'status-not_connected'}`} href="/admin/social/posts">All</Link>
          {(['draft', 'review', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'] as const).map((s) => (
            <Link key={s} className={`status-badge ${status === s ? 'status-active' : 'status-not_connected'}`} href={`/admin/social/posts?status=${s}`}>{s}</Link>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <Panel title="Nothing to show" eyebrow="Posts"><EmptyState title="No posts in this filter." description="Click 'Generate draft (AI)' on an idea in /admin/social/ideas to produce the first draft, or 'New post →' for a manual entry." tone="muted" /></Panel>
      ) : (
        <Panel title={`${rows.length} post${rows.length === 1 ? '' : 's'}`} eyebrow="Pipeline">
          <Table<PostRow>
            columns={[
              { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'published' ? 'success' : r.status === 'approved' ? 'approved' : r.status === 'review' ? 'pending' : r.status === 'cancelled' ? 'dismissed' : 'info'} label={r.status} /> },
              { key: 'acct', header: 'Account', render: (r) => `@${r.network_social_accounts?.handle ?? ''}` },
              { key: 'text', header: 'Text', render: (r) => (
                <div style={{ maxWidth: 500 }}>
                  <Link href={`/admin/social/posts/${r.id}`} style={{ fontWeight: 600 }}>{r.text.slice(0, 180)}{r.text.length > 180 ? '…' : ''}</Link>
                  <div className="col-dim" style={{ fontSize: 11 }}>{r.post_type.replace(/_/g, ' ')} · {r.text.length} chars</div>
                </div>
              ) },
              { key: 'sched', header: 'Scheduled', render: (r) => r.scheduled_for ? new Date(r.scheduled_for).toISOString().slice(0, 16).replace('T', ' ') : <span className="col-dim">—</span> },
              { key: 'ext', header: 'URL', render: (r) => r.external_url ? <a href={r.external_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>live</a> : <span className="col-dim">—</span> },
              { key: 'updated', header: 'Updated', render: (r) => formatRelative(r.updated_at) },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
