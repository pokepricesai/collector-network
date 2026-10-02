import { notFound } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { getNetworkSite, listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState, MetricCard, Panel, SectionHeader, StatusBadge,
} from '@/components/admin/admin-ui';

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
