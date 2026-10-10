import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { getNetworkSite, listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState, MetricCard, Panel, SectionHeader, StatusBadge,
} from '@/components/admin/admin-ui';
import { listTasks } from '@/server/tasks/queries';

export const dynamic = 'force-dynamic';

export default async function SiteWorkspacePage({
  params,
}: {
  params: Promise<{ site: string }>;
}) {
  const { site: slug } = await params;
  const { admin, sb } = await requireAdmin(`/admin/sites/${slug}`);
  const [sites, site] = await Promise.all([
    listNetworkSites(sb),
    getNetworkSite(sb, slug),
  ]);
  if (!site) notFound();

  // Compact open-tasks peek for this site. Site-scoped only
  // (network-scope tasks live on /admin/tasks).
  const openTasks = await listTasks(sb, { site_id: site.id, limit: 5 });

  const sections: Array<{ title: string; description: string }> = [
    { title: 'Overview',  description: 'Network-wide health snapshot for this site. Populates once Phase 1 lands GSC + GA.' },
    { title: 'SEO',       description: 'Pages, queries, indexing, opportunities, change tracking. Awaits GSC + GA.' },
    { title: 'Health',    description: 'Deployment, cron, data-ingest state, 5xx tracking. Awaits Vercel + internal ingest hooks.' },
    { title: 'Data',      description: 'Catalogue freshness, source status, job history. Read-only against the production database.' },
    { title: 'Content',   description: 'Articles, insights, FAQ coverage. Workflow lives here once content phase begins.' },
    { title: 'Revenue',   description: 'Affiliate clicks + revenue, other income, cost allocation.' },
    { title: 'Social',    description: 'X activity, scheduled posts, engagement surface.' },
  ];

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={site.slug} pathname={`/admin/sites/${site.slug}`}>
      <SectionHeader
        eyebrow={`${site.shortName}`}
        title={site.name}
        description={
          <>
            <a href={site.canonicalUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
              {site.canonicalUrl}
            </a>{' '}
            <span className="col-dim">· {site.productionApp ?? 'external'}</span>
          </>
        }
        actions={<StatusBadge state={site.status} />}
      />

      <div className="metric-grid">
        <MetricCard label="Users (28 days)"           state="not-connected" />
        <MetricCard label="Google clicks (28 days)"   state="not-connected" />
        <MetricCard label="Affiliate revenue (28 days)" state="not-connected" />
        <MetricCard label="Indexed pages"             state="not-connected" />
      </div>

      {openTasks.length > 0 && (
        <Panel title="Open tasks" actions={<Link href={`/admin/tasks?site=${site.slug}`} className="ui-btn ui-btn--secondary ui-btn--sm">View all</Link>}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {openTasks.map((t) => (
              <li key={t.id} style={{
                padding: '6px 0',
                borderBottom: '1px solid var(--admin-border)',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5,
              }}>
                <StatusBadge state={t.task_kind === 'fix' ? 'failed' : 'info'} label={t.task_kind} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                <span className="col-dim" style={{ fontSize: 11 }}>{t.task_source}</span>
                {t.priority !== 'normal' && <StatusBadge state={t.priority === 'critical' ? 'critical' : t.priority === 'high' ? 'high' : 'low'} />}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {sections.map((s) => (
        <Panel key={s.title} title={s.title} eyebrow={site.shortName}>
          <EmptyState
            title="Coming next"
            description={s.description}
            tone="muted"
          />
        </Panel>
      ))}
    </AdminShell>
  );
}
