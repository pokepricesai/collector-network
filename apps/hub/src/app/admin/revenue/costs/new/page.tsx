import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { createOpsCostAction } from '@/server/revenue/costs-actions';

export const dynamic = 'force-dynamic';

export default async function NewOpsCostPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/costs/new');
  const sites = await listNetworkSites(sb);
  const today = new Date().toISOString().slice(0, 10);
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/costs/new">
      <SectionHeader
        eyebrow="Costs"
        title="New operating cost"
        description="Direct opex only. AI and BigQuery costs are already captured — do not re-enter them here."
        actions={<Link className="status-badge status-not_connected" href="/admin/revenue/costs">← Costs</Link>}
      />
      <Panel title="Entry" eyebrow="Draft">
        <form action={createOpsCostAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 820 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Date</span>
            <input type="date" name="forDate" required defaultValue={today} style={inp} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Site (optional)</span>
            <select name="siteId" style={inp}>
              <option value="">Network-wide</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Category</span>
            <select name="category" required defaultValue="hosting" style={inp}>
              <option value="hosting">Hosting</option>
              <option value="supabase">Supabase</option>
              <option value="domain">Domain</option>
              <option value="saas">SaaS</option>
              <option value="tool">Tool</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Provider</span>
            <input name="provider" placeholder="e.g. Vercel, Supabase, Cloudflare" style={inp} />
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Description</span>
            <input name="description" placeholder="e.g. Vercel Pro — October" style={inp} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Amount</span>
            <input type="text" name="amount" required inputMode="decimal" style={inp} />
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
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>External reference</span>
            <input name="externalRef" placeholder="invoice number / payment ref" style={inp} />
          </label>
          <div style={{ gridColumn: '1 / span 2' }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Record cost</button>
          </div>
        </form>
      </Panel>
    </AdminShell>
  );
}
