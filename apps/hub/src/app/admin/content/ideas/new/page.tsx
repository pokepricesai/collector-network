import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { createManualIdeaAction } from '../actions';

export const dynamic = 'force-dynamic';

const CONTENT_TYPES = ['seo_article', 'news', 'market_analysis', 'evergreen_guide', 'set_guide', 'entity_feature', 'buying_guide', 'editorial'];

export default async function NewIdeaPage() {
  const { admin, sb } = await requireAdmin('/admin/content/ideas/new');
  const sites = await listNetworkSites(sb);
  const input: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };
  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content/ideas/new">
      <SectionHeader eyebrow="Content · Ideas · New" title="Manual idea" description="Enter a working title, pick a site + content type, and (optionally) attach a primary query. Manual ideas enter the same workflow as Phase-2-generated ones." />
      <Panel title="Details" eyebrow="Idea">
        <form action={createManualIdeaAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 820 }}>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Working title</span>
            <input name="title" required maxLength={180} style={input} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Site</span>
            <select name="siteId" required style={input}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Content type</span>
            <select name="contentType" required style={input}>
              {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Primary query (optional)</span>
            <input name="primaryQuery" style={input} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Priority</span>
            <select name="priority" style={input} defaultValue="normal">
              {['critical', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Summary / notes</span>
            <textarea name="summary" rows={4} style={{ ...input, resize: 'vertical' }} />
          </label>
          <div style={{ gridColumn: '1 / span 2' }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Create idea</button>
          </div>
        </form>
      </Panel>
    </AdminShell>
  );
}
