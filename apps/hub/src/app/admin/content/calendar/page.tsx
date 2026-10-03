import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Row { id: string; site_id: string; title: string; slug: string; status: string; content_type: string; scheduled_for: string | null; published_at: string | null; publication_url: string | null }

export default async function CalendarPage() {
  const { admin, sb } = await requireAdmin('/admin/content/calendar');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000).toISOString();
  const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();

  const [{ data: scheduled }, { data: recent }] = await Promise.all([
    sb.from('network_articles')
      .select('id, site_id, title, slug, status, content_type, scheduled_for, published_at, publication_url')
      .in('status', ['approved', 'scheduled'])
      .lt('scheduled_for', in30)
      .order('scheduled_for', { ascending: true }).limit(100),
    sb.from('network_articles')
      .select('id, site_id, title, slug, status, content_type, scheduled_for, published_at, publication_url')
      .eq('status', 'published')
      .gte('published_at', since30)
      .order('published_at', { ascending: false }).limit(50),
  ]);
  const schedRows = ((scheduled ?? []) as Row[]);
  const pubRows = ((recent ?? []) as Row[]);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content/calendar">
      <SectionHeader eyebrow="Content · Calendar" title="Content calendar" description="Articles approved + scheduled for the next 30 days, plus articles published in the past 30 days. No scheduling pressure — publish when the work is good." />
      <Panel title="Scheduled / approved" eyebrow="Next 30 days">
        {schedRows.length === 0 ? <EmptyState title="Nothing on the calendar." tone="muted" /> : (
          <Table<Row>
            columns={[
              { key: 'date', header: 'When', render: (r) => r.scheduled_for ? new Date(r.scheduled_for).toISOString().slice(0, 16).replace('T', ' ') : <span className="col-dim">unscheduled</span> },
              { key: 't', header: 'Title', render: (r) => <Link href={`/admin/content/articles/${r.id}`} style={{ fontWeight: 600 }}>{r.title}</Link> },
              { key: 'site', header: 'Site', render: (r) => sitesById.get(r.site_id)?.shortName ?? '' },
              { key: 'type', header: 'Type', render: (r) => r.content_type.replace(/_/g, ' ') },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'approved' ? 'approved' : 'info'} label={r.status} /> },
            ]}
            rows={schedRows}
          />
        )}
      </Panel>
      <Panel title="Published recently" eyebrow="Past 30 days">
        {pubRows.length === 0 ? <EmptyState title="Nothing published yet in this window." tone="muted" /> : (
          <Table<Row>
            columns={[
              { key: 'date', header: 'Published', render: (r) => r.published_at ? formatRelative(r.published_at) : '—' },
              { key: 't', header: 'Title', render: (r) => <Link href={`/admin/content/articles/${r.id}`} style={{ fontWeight: 600 }}>{r.title}</Link> },
              { key: 'site', header: 'Site', render: (r) => sitesById.get(r.site_id)?.shortName ?? '' },
              { key: 'url', header: 'URL', render: (r) => r.publication_url ? <a href={r.publication_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>{r.publication_url}</a> : '—' },
            ]}
            rows={pubRows}
          />
        )}
      </Panel>
    </AdminShell>
  );
}
