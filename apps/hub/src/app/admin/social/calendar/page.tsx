import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Row {
  id: string; text: string; status: string; post_type: string;
  scheduled_for: string | null; posted_at: string | null; external_url: string | null;
  network_social_accounts: { handle: string };
}

export default async function SocialCalendarPage() {
  const { admin, sb } = await requireAdmin('/admin/social/calendar');
  const sites = await listNetworkSites(sb);
  const now = new Date();
  const next14 = new Date(now.getTime() + 14 * 86400000).toISOString();
  const last14 = new Date(now.getTime() - 14 * 86400000).toISOString();

  const [{ data: scheduled }, { data: recentPub }] = await Promise.all([
    sb.from('network_social_posts')
      .select('id, text, status, post_type, scheduled_for, posted_at, external_url, network_social_accounts(handle)')
      .in('status', ['approved', 'scheduled']).is('parent_post_id', null)
      .not('scheduled_for', 'is', null).lt('scheduled_for', next14)
      .order('scheduled_for', { ascending: true }).limit(100),
    sb.from('network_social_posts')
      .select('id, text, status, post_type, scheduled_for, posted_at, external_url, network_social_accounts(handle)')
      .eq('status', 'published').is('parent_post_id', null)
      .gte('posted_at', last14).order('posted_at', { ascending: false }).limit(50),
  ]);

  const sched = ((scheduled ?? []) as unknown as Row[]);
  const pub = ((recentPub ?? []) as unknown as Row[]);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/social/calendar">
      <SectionHeader eyebrow="Social · Calendar" title="Social calendar" description="Scheduled + published posts in the next/last 14 days. Timezone: Europe/London presentation. No autopost pressure — publish when the content is worth it." />
      <Panel title="Scheduled / approved" eyebrow="Next 14 days">
        {sched.length === 0 ? <EmptyState title="Nothing scheduled." tone="muted" /> : (
          <Table<Row>
            columns={[
              { key: 'when', header: 'When', render: (r) => r.scheduled_for ? new Date(r.scheduled_for).toISOString().slice(0, 16).replace('T', ' ') : <span className="col-dim">unscheduled</span> },
              { key: 'acct', header: 'Account', render: (r) => `@${r.network_social_accounts?.handle ?? ''}` },
              { key: 'text', header: 'Text', render: (r) => <Link href={`/admin/social/posts/${r.id}`}>{r.text.slice(0, 180)}</Link> },
              { key: 'type', header: 'Type', render: (r) => r.post_type.replace(/_/g, ' ') },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'approved' ? 'approved' : 'info'} label={r.status} /> },
            ]}
            rows={sched}
          />
        )}
      </Panel>
      <Panel title="Published recently" eyebrow="Last 14 days">
        {pub.length === 0 ? <EmptyState title="Nothing published yet in this window." tone="muted" /> : (
          <Table<Row>
            columns={[
              { key: 'when', header: 'Posted', render: (r) => r.posted_at ? formatRelative(r.posted_at) : <span className="col-dim">—</span> },
              { key: 'acct', header: 'Account', render: (r) => `@${r.network_social_accounts?.handle ?? ''}` },
              { key: 'text', header: 'Text', render: (r) => <Link href={`/admin/social/posts/${r.id}`}>{r.text.slice(0, 180)}</Link> },
              { key: 'url', header: 'Link', render: (r) => r.external_url ? <a href={r.external_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>live</a> : <span className="col-dim">—</span> },
            ]}
            rows={pub}
          />
        )}
      </Panel>
    </AdminShell>
  );
}
