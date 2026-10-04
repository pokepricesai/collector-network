import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listPartners } from '@/server/partners/queries';
import { createSponsorshipAction } from '@/server/partners/actions';

export const dynamic = 'force-dynamic';

interface PageProps { searchParams: Promise<{ partnerId?: string }> }

export default async function NewSponsorshipPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/partners/sponsorships/new');
  const sites = await listNetworkSites(sb);
  const partners = await listPartners(sb);
  const sp = await searchParams;
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };
  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/sponsorships/new">
      <SectionHeader
        eyebrow="Partners"
        title="New sponsorship"
        description="Creates a draft deal record. No external contact, no financial transaction."
        actions={<Link className="status-badge status-not_connected" href="/admin/partners/sponsorships">← Sponsorships</Link>}
      />
      <Panel title="Deal" eyebrow="Draft">
        <form action={createSponsorshipAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 820 }}>
          <label><span style={{ fontSize: 11 }}>Partner</span>
            <select name="partnerId" required defaultValue={sp.partnerId ?? ''} style={inp}>
              <option value="">— select —</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Title</span><input name="title" required style={inp} placeholder="e.g. Grading partnership — 12mo" /></label>
          <label><span style={{ fontSize: 11 }}>Total value</span><input name="totalValue" required inputMode="decimal" style={inp} placeholder="e.g. 3600" /></label>
          <label><span style={{ fontSize: 11 }}>Currency</span>
            <select name="currency" defaultValue="GBP" style={inp}>
              <option value="GBP">GBP</option><option value="USD">USD</option><option value="EUR">EUR</option>
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Term (months)</span><input type="number" min={1} max={120} name="termMonths" style={inp} placeholder="12" /></label>
          <label><span style={{ fontSize: 11 }}>Billing cadence</span>
            <select name="billingCadence" defaultValue="monthly" style={inp}>
              <option value="monthly">monthly</option>
              <option value="quarterly">quarterly</option>
              <option value="annually">annually</option>
              <option value="one_off">one-off</option>
              <option value="milestone">milestone</option>
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Starts on</span><input type="date" name="startsOn" style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Ends on</span><input type="date" name="endsOn" style={inp} /></label>
          <fieldset style={{ gridColumn: '1 / span 2', border: '1px solid #E6E6E6', borderRadius: 4, padding: 10 }}>
            <legend style={{ fontSize: 11, padding: '0 6px' }}>Sites in deal (equal value share by default)</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {sites.map((s) => (
                <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" name="siteIds" value={s.id} /> {s.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div style={{ gridColumn: '1 / span 2' }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Create draft</button>
          </div>
        </form>
      </Panel>
    </AdminShell>
  );
}
