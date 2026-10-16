import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listCn06aPartners, listVendorCategories } from '@/server/partners/cn06a-queries';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function FirstWavePage() {
  const { admin, sb } = await requireAdmin('/admin/partners/first-wave');
  const sites = await listNetworkSites(sb);
  const [partners, categories] = await Promise.all([
    listCn06aPartners(sb, { firstWaveOnly: true }),
    listVendorCategories(sb),
  ]);
  const categoryLabel = (code: string | null) =>
    code ? (categories.find((c) => c.code === code)?.display_name ?? code) : '—';

  const avgFit = partners.filter((p) => p.fit_score != null).reduce((a, b) => a + (b.fit_score ?? 0), 0)
    / Math.max(1, partners.filter((p) => p.fit_score != null).length);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/first-wave">
      <SectionHeader
        eyebrow="CN-06A"
        title="First-wave prospects"
        description={
          <span>
            {partners.length} prospects flagged for the opening outreach wave. Average fit score {avgFit ? Math.round(avgFit) : '—'}. All outreach is operator-reviewed; the system never sends.
          </span>
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners">All prospects</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/categories">Categories</Link>
          </span>
        }
      />
      <Panel title={`First-wave list (${partners.length})`} eyebrow="Ranked by fit score">
        <Table
          rows={partners}
          columns={[
            { key: 'fit', header: 'Fit', className: 'num', render: (r) => r.fit_score != null ? <strong>{r.fit_score}</strong> : <span className="col-dim">—</span> },
            { key: 'name', header: 'Partner', render: (r) => (
              <span>
                <Link href={`/admin/partners/${r.id}`}><strong>{r.display_name}</strong></Link>
                {r.website && <> · <a href={r.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>site</a></>}
              </span>
            ) },
            { key: 'category', header: 'Category', render: (r) => <span style={{ fontSize: 12 }}>{categoryLabel(r.vendor_category)}</span> },
            { key: 'tcgs', header: 'TCGs', render: (r) => r.relevant_tcgs?.length ? r.relevant_tcgs.join('·') : <span className="col-dim">—</span> },
            { key: 'size', header: 'Size', render: (r) => r.estimated_size ?? <span className="col-dim">—</span> },
            { key: 'rec', header: 'Recommended', render: (r) => r.recommended_price_minor != null ? `£${(r.recommended_price_minor / 100).toLocaleString()}/mo` : <span className="col-dim">—</span> },
            { key: 'status', header: 'Stage', render: (r) => <StatusBadge state={r.status === 'won' ? 'success' : r.status === 'lost' ? 'failed' : 'info'} label={r.status.replace(/_/g, ' ')} /> },
            { key: 'contact', header: 'Last contact', render: (r) => <span className="col-dim" style={{ fontSize: 11 }}>{r.last_contact_at ? formatRelative(r.last_contact_at) : 'Never'}</span> },
          ]}
          empty={<span className="col-dim">No first-wave prospects flagged yet. Set the First-wave flag on a partner profile.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
