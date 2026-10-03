import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { CHANGE_TYPES } from '@/server/changes/engine';
import { createChangeAction } from '../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NewChangePage() {
  const { admin, sb } = await requireAdmin('/admin/seo/changes/new');
  const sites = await listNetworkSites(sb);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/seo/changes/new">
      <SectionHeader
        eyebrow="SEO · Changes · New"
        title="Log an SEO change"
        description="Record a title/meta/content/schema/canonical/template change. Pick 'deployed' to start the measurement window immediately."
      />
      <Panel title="Details" eyebrow="Change">
        <form action={createChangeAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 820 }}>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Title</span>
            <input name="title" required maxLength={200} style={inputStyle} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Site</span>
            <select name="siteId" required style={inputStyle}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Change type</span>
            <select name="changeType" required style={inputStyle}>
              {CHANGE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</span>
            <select name="status" required style={inputStyle}>
              <option value="proposed">proposed</option>
              <option value="deployed">deployed (starts measurement)</option>
              <option value="measuring">measuring</option>
              <option value="completed">completed</option>
              <option value="rolled_back">rolled back</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Commit SHA (optional)</span>
            <input name="commitSha" maxLength={40} style={inputStyle} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Single URL (optional)</span>
            <input name="url" placeholder="https://pokeprices.io/cards/..." style={inputStyle} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>URL pattern (optional)</span>
            <input name="urlPattern" placeholder="/cards/*" style={inputStyle} />
          </label>

          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Description</span>
            <textarea name="description" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Old value</span>
            <textarea name="oldValue" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>New value</span>
            <textarea name="newValue" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </label>

          <div style={{ gridColumn: '1 / span 2', display: 'flex', gap: 8 }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Record change</button>
          </div>
        </form>
      </Panel>
    </AdminShell>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #D4D4D4',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'inherit',
};
