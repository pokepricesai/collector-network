import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { updateIdeaAction } from '../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CONTENT_TYPES = ['seo_article', 'news', 'market_analysis', 'evergreen_guide', 'set_guide', 'entity_feature', 'buying_guide', 'editorial'];

interface Params { params: Promise<{ id: string }> }

export default async function EditIdeaPage({ params }: Params) {
  const { admin, sb } = await requireAdmin('/admin/content/ideas');
  const { id } = await params;
  const sites = await listNetworkSites(sb);
  const { data: row } = await sb.from('network_content_ideas')
    .select('id, site_id, content_type, working_title, primary_query, summary, notes, priority, status, origin_type, evidence, last_seen_at, approved_at, network_sites(slug, name)')
    .eq('id', id).maybeSingle();
  if (!row) notFound();
  const idea = row as unknown as {
    id: string; site_id: string; content_type: string; working_title: string;
    primary_query: string | null; summary: string | null; notes: string | null;
    priority: string; status: string; origin_type: string; evidence: Record<string, unknown>;
    last_seen_at: string; approved_at: string | null;
    network_sites: { slug: string; name: string };
  };

  const input: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };
  const readOnly = idea.status !== 'new';

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={idea.network_sites.slug} pathname={`/admin/content/ideas/${id}`}>
      <SectionHeader
        eyebrow={`Content · Idea · ${idea.network_sites.name}`}
        title={idea.working_title}
        description={`${idea.content_type.replace(/_/g, ' ')} · origin: ${idea.origin_type} · priority ${idea.priority}`}
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/ideas">← Back</Link>}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <StatusBadge state={idea.status === 'approved' ? 'approved' : idea.status === 'dismissed' ? 'rejected' : 'pending'} label={idea.status.replace(/_/g, ' ')} />
        {idea.approved_at && <span className="col-dim" style={{ fontSize: 11 }}>approved {idea.approved_at.slice(0, 10)}</span>}
        {readOnly && <span className="col-dim" style={{ fontSize: 11 }}>read-only — only 'new' ideas can be edited</span>}
      </div>

      <Panel title="Idea details" eyebrow="Edit">
        <form action={updateIdeaAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 820 }}>
          <input type="hidden" name="id" value={id} />
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Working title</span>
            <input name="title" required maxLength={180} defaultValue={idea.working_title} style={input} disabled={readOnly} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Content type</span>
            <select name="contentType" required defaultValue={idea.content_type} style={input} disabled={readOnly}>
              {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Priority</span>
            <select name="priority" defaultValue={idea.priority} style={input} disabled={readOnly}>
              {['critical', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Primary query (optional)</span>
            <input name="primaryQuery" defaultValue={idea.primary_query ?? ''} style={input} disabled={readOnly} />
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Summary</span>
            <textarea name="summary" rows={3} defaultValue={idea.summary ?? ''} style={{ ...input, resize: 'vertical' }} disabled={readOnly} />
          </label>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Editorial notes (private)</span>
            <textarea name="notes" rows={3} defaultValue={idea.notes ?? ''} style={{ ...input, resize: 'vertical' }} disabled={readOnly} />
          </label>
          {!readOnly && (
            <div style={{ gridColumn: '1 / span 2' }}>
              <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Save changes</button>
            </div>
          )}
        </form>
      </Panel>

      <Panel title="Evidence" eyebrow="Deterministic signals (read-only)">
        <pre style={{ background: 'var(--admin-bg-subtle)', padding: 12, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 320 }}>
          {JSON.stringify(idea.evidence, null, 2)}
        </pre>
      </Panel>
    </AdminShell>
  );
}
