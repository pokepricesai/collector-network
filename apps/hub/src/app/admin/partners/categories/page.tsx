import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  listCategoryCounts,
  listVendorCategories,
  listVendorOffers,
} from '@/server/partners/cn06a-queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CategoriesPage() {
  const { admin, sb } = await requireAdmin('/admin/partners/categories');
  const sites = await listNetworkSites(sb);
  const [categories, counts, offers] = await Promise.all([
    listVendorCategories(sb),
    listCategoryCounts(sb),
    listVendorOffers(sb),
  ]);
  const countMap = new Map(counts.map((c) => [c.vendor_category, c]));
  const offersByCat = new Map<string, number>();
  for (const o of offers) offersByCat.set(o.category_code, (offersByCat.get(o.category_code) ?? 0) + 1);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/categories">
      <SectionHeader
        eyebrow="CN-06A"
        title="Vendor categories"
        description={<span>{categories.length} commercially relevant US TCG vendor types. Each category defines its own target customer, audience fit, intro / premium pricing and sponsorship offers.</span>}
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners">All prospects</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/first-wave">First-wave</Link>
          </span>
        }
      />
      <Panel title="Catalogue" eyebrow="Click a category to filter the partner list">
        <Table
          rows={categories.map((c) => ({ ...c, id: c.code }))}
          columns={[
            { key: 'name', header: 'Category', render: (c) => (
              <Link href={`/admin/partners?category=${encodeURIComponent(c.code)}`}>
                <strong>{c.display_name}</strong>
              </Link>
            ) },
            { key: 'target', header: 'Target customer', render: (c) => <span style={{ fontSize: 12 }}>{c.target_customer}</span> },
            { key: 'tcgs', header: 'Default TCGs', render: (c) => c.default_relevant_tcgs?.join('·') ?? '—' },
            { key: 'intro', header: 'Entry price', className: 'num', render: (c) => `£${(c.intro_price_minor / 100).toLocaleString()}/mo` },
            { key: 'premium', header: 'Premium', className: 'num', render: (c) => c.premium_price_minor != null ? `£${(c.premium_price_minor / 100).toLocaleString()}/mo` : <span className="col-dim">—</span> },
            { key: 'offers', header: 'Offers', className: 'num', render: (c) => offersByCat.get(c.code) ?? 0 },
            { key: 'count', header: 'Prospects', className: 'num', render: (c) => {
              const stat = countMap.get(c.code);
              return stat ? <span><strong>{stat.count}</strong>{stat.avg_fit != null && <span className="col-dim"> · fit {stat.avg_fit}</span>}</span> : <span className="col-dim">0</span>;
            } },
          ]}
          empty={<span className="col-dim">No categories defined.</span>}
        />
      </Panel>

      <Panel title={`Sponsorship offer catalogue (${offers.length})`} eyebrow="Grouped by category">
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
          {categories.map((cat) => {
            const catOffers = offers.filter((o) => o.category_code === cat.code);
            if (catOffers.length === 0) return null;
            return (
              <li key={cat.code} style={{ borderTop: '1px solid var(--admin-border, #eee)', padding: '10px 0' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{cat.display_name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                  {catOffers.map((o) => (
                    <div key={o.id} style={{ padding: 8, border: '1px solid var(--admin-border, #eee)', borderRadius: 4 }}>
                      <div style={{ fontSize: 12 }}>
                        <strong>{o.display_name}</strong>{' '}
                        <StatusBadge state={o.tier === 'premium' ? 'warning' : 'info'} label={o.tier} />
                        {!o.is_live_capability && <StatusBadge state="suppressed" label="needs build" />}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 4 }}>{o.description}</div>
                      <div style={{ fontSize: 11, marginTop: 4 }}>
                        <strong>£{(o.price_minor / 100).toLocaleString()}</strong>/mo · {o.term_months} mo · sites: {o.placement_sites.join(', ')}
                      </div>
                      {o.development_notes && <div className="col-dim" style={{ fontSize: 10, marginTop: 4 }}>Dev: {o.development_notes}</div>}
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </AdminShell>
  );
}
