import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  getSponsorship,
  listSponsorshipSites,
  listDeliverables,
  sponsorshipRevenueTotals,
  listOffers,
} from '@/server/partners/queries';
import {
  updateSponsorshipAction,
  addDeliverableAction,
} from '@/server/partners/actions';
import { formatDateOnly, formatMoneyMinor, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STATUSES = ['draft', 'proposed', 'accepted', 'active', 'renewing', 'paused', 'ended', 'cancelled'];

interface Params { params: Promise<{ id: string }> }

export default async function SponsorshipDetailPage({ params }: Params) {
  const { admin, sb } = await requireAdmin('/admin/partners/sponsorships');
  const sites = await listNetworkSites(sb);
  const { id } = await params;
  const [sp, spSites, deliverables, revenue, offers] = await Promise.all([
    getSponsorship(sb, id),
    listSponsorshipSites(sb, id),
    listDeliverables(sb, id),
    sponsorshipRevenueTotals(sb, id),
    listOffers(sb),
  ]);
  if (!sp) notFound();
  const bookedThis = revenue.find((r) => r.currency === sp.currency)?.booked_minor ?? 0;
  const bookedPct = sp.total_value_minor > 0 ? Math.min(100, (bookedThis / sp.total_value_minor) * 100) : 0;
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname={`/admin/partners/sponsorships/${id}`}>
      <SectionHeader
        eyebrow={`Sponsorship · ${sp.network_partners?.display_name ?? '—'}`}
        title={sp.title}
        description={
          <span>
            <StatusBadge state={sp.status === 'active' ? 'success' : sp.status === 'cancelled' ? 'failed' : 'info'} label={sp.status} />{' · '}
            {formatMoneyMinor(sp.total_value_minor, sp.currency)} · {sp.billing_cadence}
            {sp.term_months && <> · {sp.term_months} months</>}
            {sp.starts_on && <> · {formatDateOnly(sp.starts_on)}</>}{sp.ends_on && <> → {formatDateOnly(sp.ends_on)}</>}
            {sp.renewal_reminder_on && <> · renewal reminder {formatDateOnly(sp.renewal_reminder_on)}</>}
          </span>
        }
        actions={<Link className="status-badge status-not_connected" href={`/admin/partners/${sp.partner_id}`}>← Partner</Link>}
      />

      <Panel title="Booked vs contracted" eyebrow="Revenue attribution">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          <div className="metric-card">
            <div className="metric-label">Contracted</div>
            <div className="metric-value metric-value--ok">{formatMoneyMinor(sp.total_value_minor, sp.currency)}</div>
            <div className="metric-helper">pipeline value (not revenue)</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Booked (events attributed)</div>
            <div className="metric-value metric-value--ok">{formatMoneyMinor(bookedThis, sp.currency)}</div>
            <div className="metric-helper">{bookedPct.toFixed(0)}% of contracted</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Status</div>
            <div className="metric-value metric-value--ok">{sp.status}</div>
            <div className="metric-helper">updated {formatRelative(sp.created_at)}</div>
          </div>
        </div>
      </Panel>

      <Panel title="Sites in deal" eyebrow="Attribution">
        {spSites.length === 0 ? <span className="col-dim">Network-wide (no site rows).</span> : (
          <Table
            rows={spSites.map((r, i) => ({ id: i, ...r }))}
            columns={[
              { key: 'site', header: 'Site', render: (r) => r.network_sites?.name ?? r.site_id },
              { key: 'share', header: 'Value share', className: 'num', render: (r) => `${(r.value_share * 100).toFixed(1)}%` },
            ]}
          />
        )}
      </Panel>

      <Panel title={`Deliverables (${deliverables.length})`} eyebrow="Scope">
        <Table
          rows={deliverables}
          columns={[
            { key: 'name', header: 'Deliverable', render: (d) => <strong>{d.display_name}</strong> },
            { key: 'cat', header: 'Category', render: (d) => <StatusBadge state="info" label={d.category.replace(/_/g, ' ')} /> },
            { key: 'site', header: 'Site', render: (d) => d.network_sites?.name ?? <span className="col-dim">network</span> },
            { key: 'place', header: 'Placement', render: (d) => <span className="col-dim" style={{ fontSize: 12 }}>{d.placement_hint ?? ''}</span> },
            { key: 'qty', header: 'Qty', className: 'num', render: (d) => d.quantity },
            { key: 'status', header: 'Status', render: (d) => <StatusBadge state={d.status === 'live' ? 'success' : 'info'} label={d.status.replace(/_/g, ' ')} /> },
          ]}
          empty={<span className="col-dim">No deliverables yet. Add one below.</span>}
        />
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>+ Add deliverable</summary>
          <form action={addDeliverableAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10, maxWidth: 820 }}>
            <input type="hidden" name="sponsorshipId" value={sp.id} />
            <label><span style={{ fontSize: 11 }}>From catalogue (optional)</span>
              <select name="offerId" style={inp}>
                <option value="">— custom —</option>
                {offers.map((o) => <option key={o.id} value={o.id}>{o.display_name} · {o.category}</option>)}
              </select>
            </label>
            <label><span style={{ fontSize: 11 }}>Site (optional)</span>
              <select name="siteId" style={inp}>
                <option value="">Network-wide</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label><span style={{ fontSize: 11 }}>Display name</span><input name="displayName" required style={inp} placeholder="e.g. Homepage banner on Pokémon" /></label>
            <label><span style={{ fontSize: 11 }}>Category</span><input name="category" required style={inp} placeholder="placement / content / data / graded_cta / premium_listing" /></label>
            <label><span style={{ fontSize: 11 }}>Quantity</span><input type="number" min={1} name="quantity" defaultValue={1} style={inp} /></label>
            <label><span style={{ fontSize: 11 }}>Placement hint</span><input name="placementHint" style={inp} /></label>
            <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Notes</span><input name="notes" style={inp} /></label>
            <div style={{ gridColumn: '1 / span 2' }}><button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Add deliverable</button></div>
          </form>
        </details>
      </Panel>

      <Panel title="Edit deal" eyebrow="State">
        <form action={updateSponsorshipAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 820 }}>
          <input type="hidden" name="id" value={sp.id} />
          <label><span style={{ fontSize: 11 }}>Title</span><input name="title" defaultValue={sp.title} style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Status</span>
            <select name="status" defaultValue={sp.status} style={inp}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Total value</span><input name="totalValue" defaultValue={(sp.total_value_minor / 100).toFixed(2)} style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Currency</span>
            <select name="currency" defaultValue={sp.currency} style={inp}>
              <option value="GBP">GBP</option><option value="USD">USD</option><option value="EUR">EUR</option>
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Starts on</span><input type="date" name="startsOn" defaultValue={sp.starts_on ?? ''} style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Ends on</span><input type="date" name="endsOn" defaultValue={sp.ends_on ?? ''} style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Billing cadence</span>
            <select name="billingCadence" defaultValue={sp.billing_cadence} style={inp}>
              <option value="one_off">one-off</option>
              <option value="monthly">monthly</option>
              <option value="quarterly">quarterly</option>
              <option value="annually">annually</option>
              <option value="milestone">milestone</option>
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Signed at</span><input type="datetime-local" name="signedAt" defaultValue={sp.signed_at ? sp.signed_at.slice(0, 16) : ''} style={inp} /></label>
          <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Notes</span><textarea name="notes" rows={3} defaultValue={sp.notes ?? ''} style={{ ...inp, resize: 'vertical' }} /></label>
          <div style={{ gridColumn: '1 / span 2' }}><button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Save</button></div>
        </form>
      </Panel>
    </AdminShell>
  );
}
