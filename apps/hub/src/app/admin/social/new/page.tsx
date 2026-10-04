import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { createManualPostAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewPostPage() {
  const { admin, sb } = await requireAdmin('/admin/social/new');
  const sites = await listNetworkSites(sb);
  const { data: accounts } = await sb.from('network_social_accounts').select('id, display_name, handle').eq('status', 'active');
  const accs = (accounts ?? []) as Array<{ id: string; display_name: string; handle: string }>;

  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/social/new">
      <SectionHeader eyebrow="Social · New post" title="Manual post" description="Spontaneous post not tied to an idea. Still runs through approval + dry-run + live publish like any other post." />
      <Panel title="Details" eyebrow="Draft">
        <form action={createManualPostAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 820 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Account</span>
            <select name="accountId" required style={inp}>
              {accs.map((a) => <option key={a.id} value={a.id}>{a.display_name} (@{a.handle})</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Scheduled for (optional, UTC)</span>
            <input type="datetime-local" name="scheduledFor" style={inp} />
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Text (280 max)</span>
            <textarea name="text" required maxLength={280} rows={5} style={{ ...inp, resize: 'vertical' }} />
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Notes (private)</span>
            <input name="notes" style={inp} />
          </label>
          <div style={{ gridColumn: '1 / span 2' }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Create draft</button>
          </div>
        </form>
      </Panel>
    </AdminShell>
  );
}
