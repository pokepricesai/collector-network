import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';
import { PostActions } from '../../SocialActions';
import { updatePostAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

interface Params { params: Promise<{ id: string }> }

interface PostRow {
  id: string; account_id: string; text: string; links: string[]; status: string; post_type: string;
  scheduled_for: string | null; posted_at: string | null; external_post_id: string | null; external_url: string | null;
  parent_post_id: string | null; thread_position: number;
  evidence: Record<string, unknown>;
  qc_report: Record<string, unknown>;
  ai_model: string | null; ai_est_cost_usd: number | null;
  created_at: string; updated_at: string;
  network_social_accounts: { handle: string; display_name: string; platform: string };
}

export default async function PostDetail({ params }: Params) {
  const { admin, sb } = await requireAdmin('/admin/social/posts');
  const sites = await listNetworkSites(sb);
  const { id } = await params;

  const [{ data: postRaw }, { data: children }, { data: versions }, { data: pubs }] = await Promise.all([
    sb.from('network_social_posts')
      .select('id, account_id, text, links, status, post_type, scheduled_for, posted_at, external_post_id, external_url, parent_post_id, thread_position, evidence, qc_report, ai_model, ai_est_cost_usd, created_at, updated_at, network_social_accounts(handle, display_name, platform)')
      .eq('id', id).maybeSingle(),
    sb.from('network_social_posts').select('id, text, status, thread_position, external_url').eq('parent_post_id', id).order('thread_position', { ascending: true }),
    sb.from('network_social_versions').select('version, actor_type, change_note, created_at').eq('post_id', id).order('version', { ascending: false }).limit(20),
    sb.from('network_social_publications').select('id, mode, status, idempotency_key, attempted_at, completed_at, payload, response, error_summary').eq('post_id', id).order('attempted_at', { ascending: false }).limit(10),
  ]);
  if (!postRaw) notFound();
  const p = postRaw as unknown as PostRow;
  const thread = ((children ?? []) as Array<{ id: string; text: string; status: string; thread_position: number; external_url: string | null }>);
  const vrs = ((versions ?? []) as Array<{ version: number; actor_type: string; change_note: string | null; created_at: string }>);
  const publications = ((pubs ?? []) as Array<{ id: string; mode: string; status: string; idempotency_key: string; attempted_at: string; completed_at: string | null; payload: Record<string, unknown>; response: Record<string, unknown>; error_summary: string | null }>);

  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit', width: '100%' };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname={`/admin/social/posts/${id}`}>
      <SectionHeader
        eyebrow={`Social · Post · @${p.network_social_accounts.handle}`}
        title={p.text.slice(0, 100)}
        description={<span>{p.post_type.replace(/_/g, ' ')} · <StatusBadge state={p.status === 'published' ? 'success' : p.status === 'approved' ? 'approved' : p.status === 'cancelled' ? 'dismissed' : 'info'} label={p.status} /> · <code>{p.network_social_accounts.platform}</code> · <code>@{p.network_social_accounts.handle}</code>{p.external_url && <> · <a href={p.external_url} target="_blank" rel="noopener noreferrer">live post</a></>}</span>}
        actions={<Link className="status-badge status-not_connected" href="/admin/social/posts">← All posts</Link>}
      />

      <Panel title="Edit" eyebrow="Draft">
        <form action={async (fd: FormData) => { 'use server'; await updatePostAction(fd); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input type="hidden" name="id" value={p.id} />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Text (280 chars max)</span>
            <textarea name="text" rows={5} maxLength={280} defaultValue={p.text} style={{ ...inp, resize: 'vertical' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Schedule for (optional, UTC)</span>
            <input type="datetime-local" name="scheduledFor" defaultValue={p.scheduled_for ? p.scheduled_for.slice(0, 16) : ''} style={inp} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Change note</span>
            <input name="changeNote" placeholder="Why this edit?" style={inp} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Save</button>
            <PostActions postId={p.id} status={p.status} mode="editor" />
          </div>
        </form>
      </Panel>

      {thread.length > 0 && (
        <Panel title={`Thread (${thread.length + 1} posts total)`} eyebrow="Children">
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li style={{ marginBottom: 10 }}>
              <strong>{p.text}</strong>
              <div className="col-dim" style={{ fontSize: 11 }}>parent · {p.text.length} chars</div>
            </li>
            {thread.map((c) => (
              <li key={c.id} style={{ marginBottom: 10 }}>
                <Link href={`/admin/social/posts/${c.id}`}>{c.text}</Link>
                <div className="col-dim" style={{ fontSize: 11 }}>#{c.thread_position} · {c.text.length} chars · <StatusBadge state={c.status === 'published' ? 'success' : 'info'} label={c.status} /></div>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="Evidence" eyebrow="Source">
        <pre style={{ fontSize: 11, background: '#FAFAFA', padding: 10, borderRadius: 4, maxHeight: 320, overflow: 'auto' }}>{JSON.stringify(p.evidence, null, 2)}</pre>
      </Panel>

      <Panel title="Publications" eyebrow="Attempts">
        {publications.length === 0 ? <span className="col-dim" style={{ fontSize: 12 }}>No attempts yet. Dry-run first to verify payload.</span> : (
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
            {publications.map((pb) => (
              <li key={pb.id} style={{ marginBottom: 10 }}>
                <strong>{pb.mode.toUpperCase()}</strong> · <StatusBadge state={pb.status === 'success' ? 'success' : pb.status === 'failed' ? 'failed' : 'info'} label={pb.status} /> · {formatRelative(pb.attempted_at)}
                {pb.error_summary && <div style={{ color: '#8A1C27' }}>{pb.error_summary}</div>}
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer' }}>Payload</summary>
                  <pre style={{ fontSize: 10, background: '#FAFAFA', padding: 6, borderRadius: 4, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(pb.payload, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Version history" eyebrow="Snapshots">
        {vrs.length === 0 ? <span className="col-dim" style={{ fontSize: 12 }}>No versions yet.</span> : (
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
            {vrs.map((v) => (
              <li key={v.version}><strong>v{v.version}</strong> · {v.actor_type} · {formatRelative(v.created_at)}{v.change_note && <span className="col-dim"> — {v.change_note}</span>}</li>
            ))}
          </ul>
        )}
      </Panel>
    </AdminShell>
  );
}
