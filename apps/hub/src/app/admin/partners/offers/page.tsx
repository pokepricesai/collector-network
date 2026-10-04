import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listOffers } from '@/server/partners/queries';
import { createOfferAction } from '@/server/partners/actions';
import { formatMoneyMinor } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function OffersPage() {
  const { admin, sb } = await requireAdmin('/admin/partners/offers');
  const sites = await listNetworkSites(sb);
  const offers = await listOffers(sb);
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };
  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/offers">
      <SectionHeader
        eyebrow="Partners"
        title="Commercial offer catalogue"
        description="Reusable building blocks. A sponsorship is a bundle of these at an agreed price."
        actions={<Link className="status-badge status-not_connected" href="/admin/partners">← Partners</Link>}
      />
      <Panel title={`Offers (${offers.length})`} eyebrow="Catalogue">
        <Table
          rows={offers}
          columns={[
            { key: 'name', header: 'Offer', render: (o) => <span><strong>{o.display_name}</strong> <code className="col-dim" style={{ fontSize: 11 }}>{o.slug}</code></span> },
            { key: 'cat', header: 'Category', render: (o) => <StatusBadge state="info" label={o.category.replace(/_/g, ' ')} /> },
            { key: 'scope', header: 'Scope', render: (o) => <code style={{ fontSize: 11 }}>{o.default_scope.replace(/_/g, ' ')}</code> },
            { key: 'unit', header: 'Unit', render: (o) => <code style={{ fontSize: 11 }}>{o.default_unit}</code> },
            { key: 'price', header: 'Rate card', className: 'num', render: (o) => o.default_price_minor != null ? formatMoneyMinor(o.default_price_minor, o.default_currency) : <span className="col-dim">on request</span> },
            { key: 'desc', header: 'Description', render: (o) => <span className="col-dim" style={{ fontSize: 12 }}>{o.description ?? ''}</span> },
            { key: 'active', header: 'Active', render: (o) => <StatusBadge state={o.is_active ? 'success' : 'dismissed'} label={o.is_active ? 'active' : 'off'} /> },
          ]}
          empty={<span className="col-dim">No offers.</span>}
        />
      </Panel>
      <Panel title="Add offer" eyebrow="Catalogue">
        <form action={createOfferAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 820 }}>
          <label><span style={{ fontSize: 11 }}>Name</span><input name="name" required style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Category</span><input name="category" required style={inp} placeholder="placement / content / data / graded_cta / premium_listing / bundle / other" /></label>
          <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Description</span><input name="description" style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Default scope</span>
            <select name="defaultScope" defaultValue="single_site" style={inp}>
              <option value="single_site">single site</option>
              <option value="multi_site">multi site</option>
              <option value="network_wide">network wide</option>
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Default unit</span>
            <select name="defaultUnit" defaultValue="month" style={inp}>
              <option value="month">month</option>
              <option value="quarter">quarter</option>
              <option value="year">year</option>
              <option value="one_off">one-off</option>
              <option value="cpm">CPM</option>
              <option value="cpc">CPC</option>
              <option value="revshare">rev-share</option>
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Default price (decimal)</span><input name="defaultPrice" type="text" inputMode="decimal" style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Currency</span>
            <select name="defaultCurrency" defaultValue="GBP" style={inp}>
              <option value="GBP">GBP</option><option value="USD">USD</option><option value="EUR">EUR</option>
            </select>
          </label>
          <div style={{ gridColumn: '1 / span 2' }}><button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Add offer</button></div>
        </form>
      </Panel>
    </AdminShell>
  );
}
