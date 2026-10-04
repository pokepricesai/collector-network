import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { createPartnerAction } from '@/server/partners/actions';

export const dynamic = 'force-dynamic';

const KINDS = [
  'grading_company', 'lgs', 'marketplace', 'scanner_tool', 'accessory',
  'storage', 'auction', 'vendor', 'content_creator', 'event',
  'tcgplayer_direct', 'ebay', 'other',
];

export default async function NewPartnerPage() {
  const { admin, sb } = await requireAdmin('/admin/partners/new');
  const sites = await listNetworkSites(sb);
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };
  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/new">
      <SectionHeader
        eyebrow="Partners"
        title="New partner"
        description="Creates a prospect record. No external contact is made."
        actions={<Link className="status-badge status-not_connected" href="/admin/partners">← All partners</Link>}
      />
      <Panel title="Details" eyebrow="Draft">
        <form action={createPartnerAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 820 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / span 2' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Name</span>
            <input name="name" required style={inp} placeholder="e.g. Imperium Grading" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Kind</span>
            <select name="kind" required defaultValue="grading_company" style={inp}>
              {KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Priority (1 critical … 5 low)</span>
            <input type="number" name="priority" min={1} max={5} defaultValue={3} style={inp} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / span 2' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Website</span>
            <input name="website" style={inp} placeholder="https://..." />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / span 2' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Description</span>
            <textarea name="description" rows={3} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Intro source</span>
            <input name="introSource" style={inp} placeholder="how we met them" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tags (comma)</span>
            <input name="tags" style={inp} />
          </label>
          <div style={{ gridColumn: '1 / span 2' }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Create partner</button>
          </div>
        </form>
      </Panel>
    </AdminShell>
  );
}
