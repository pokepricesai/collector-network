import { ModulePage } from '@/components/admin/ModulePage';
import { Panel } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SeoLanding() {
  const { sb } = await requireAdmin('/admin/seo');
  const sites = await listNetworkSites(sb);
  return (
    <ModulePage
      pathname="/admin/seo"
      eyebrow="SEO"
      title="SEO portfolio"
      description="Pages, queries, indexing and opportunities across the five sites. Google Search Console is not connected yet; the full module lands in Phase 1."
      headline={
        <Panel title="Sites in the SEO portfolio" eyebrow="Sites">
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {sites.map((s) => (
              <li key={s.slug} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 2px' }}>
                <Link href={`/admin/sites/${s.slug}`} style={{ fontWeight: 600 }}>{s.name}</Link>
                <span className="col-dim" style={{ fontSize: 12 }}>Google Search Console not connected</span>
              </li>
            ))}
          </ul>
        </Panel>
      }
      sections={[
        { title: 'Overview',       description: 'Clicks, impressions, position, CTR trends per site and across the network.' },
        { title: 'Pages',          description: 'Per-page GSC performance with internal metadata overlays.' },
        { title: 'Queries',        description: 'Query-level performance; growth, decay and opportunity surfaces.' },
        { title: 'Opportunities',  description: 'Striking-distance pages, pages that lost traffic, missing coverage.' },
        { title: 'Indexing',       description: 'URL inspection state, submission history, Indexed vs Crawled vs Discovered.' },
        { title: 'Sitemaps',       description: 'Submitted-vs-crawled counts, warnings, last fetch.' },
        { title: 'Changes',        description: 'Deploy-tagged change tracking so impact can be attributed.' },
        { title: 'Internal links', description: 'Cross-site and in-site linking health.' },
        { title: 'Tasks',          description: 'Opportunities that have been promoted to actionable tasks.' },
      ]}
    />
  );
}
