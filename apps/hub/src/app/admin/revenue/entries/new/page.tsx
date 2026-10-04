import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listRevenueSources } from '@/server/revenue/queries';
import { createRevenueEventAction } from '@/server/revenue/actions';

export const dynamic = 'force-dynamic';

export default async function NewRevenueEntryPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/entries/new');
  const [sites, sources] = await Promise.all([
    listNetworkSites(sb),
    listRevenueSources(sb),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/entries/new">
      <SectionHeader
        eyebrow="Revenue"
        title="Manual revenue entry"
        description="Record a reconciled revenue line from an external report, invoice or payout. Nothing is sent anywhere — this writes a single row to network_revenue_events, visible in the dashboard."
        actions={<Link className="status-badge status-not_connected" href="/admin/revenue">← Dashboard</Link>}
      />
      <Panel title="Entry" eyebrow="Draft">
        <form action={createRevenueEventAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 820 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Source</span>
            <select name="sourceId" required style={inp}>
              <option value="">— select —</option>
              {sources.filter((s) => s.is_active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name} ({s.kind.replace(/_/g, ' ')}) · {s.default_currency}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Site (optional)</span>
            <select name="siteId" style={inp}>
              <option value="">Network-wide</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Occurred on</span>
            <input type="date" name="occurredOn" required defaultValue={today} style={inp} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Event kind</span>
            <select name="eventKind" required defaultValue="revenue" style={inp}>
              <option value="revenue">Revenue</option>
              <option value="refund">Refund (stored as negative)</option>
              <option value="adjustment">Adjustment</option>
              <option value="reversal">Reversal (negative)</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Amount (decimal, same currency)</span>
            <input type="text" name="amount" required inputMode="decimal" placeholder="e.g. 300.00" style={inp} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Currency</span>
            <select name="currency" required defaultValue="GBP" style={inp}>
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Description</span>
            <input name="description" placeholder="e.g. Imperium — month 1 of 12" style={inp} />
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>External reference (invoice no., batch id)</span>
            <input name="externalRef" placeholder="e.g. INV-2026-10-001" style={inp} />
          </label>
          <input type="hidden" name="sponsorshipId" value="" />
          <input type="hidden" name="partnerId" value="" />
          <div style={{ gridColumn: '1 / span 2', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Record entry</button>
            <span className="col-dim" style={{ fontSize: 11 }}>
              Idempotent on (source + site + date + amount + external ref + you). Nothing external is contacted.
            </span>
          </div>
        </form>
      </Panel>
    </AdminShell>
  );
}
