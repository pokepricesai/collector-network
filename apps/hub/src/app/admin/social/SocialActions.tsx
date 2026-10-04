'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { regenerateSocialIdeasAction, generatePostDraftAction, approvePostAction, cancelPostAction, publishPostAction } from './actions';

export function RegenerateSocialIdeasButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        className={`status-badge ${pending ? 'status-not_connected' : 'status-opportunity'}`}
        disabled={pending}
        style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
        onClick={() => start(async () => {
          const r = await regenerateSocialIdeasAction();
          setMsg(r.results.map((s) => `${s.account}: +${s.generated}/~${s.refreshed}`).join(' · '));
        })}
      >{pending ? 'Scanning…' : 'Regenerate from evidence'}</button>
      {msg && <span className="col-dim" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}

export function IdeaRowActions(props: { ideaId: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  if (props.status !== 'new') return <span className="col-dim" style={{ fontSize: 11 }}>{props.status}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <button
        className={`status-badge ${pending ? 'status-not_connected' : 'status-opportunity'}`}
        disabled={pending}
        style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
        onClick={() => start(async () => {
          const r = await generatePostDraftAction(props.ideaId, false);
          if (r.ok && r.postId) { setMsg('drafted'); router.push(`/admin/social/posts/${r.postId}`); }
          else setMsg(r.error ?? 'error');
        })}
      >{pending ? 'Drafting…' : 'Generate draft (AI)'}</button>
      <button
        className={`status-badge ${pending ? 'status-not_connected' : 'status-not_connected'}`}
        disabled={pending}
        style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 10 }}
        onClick={() => start(async () => {
          const r = await generatePostDraftAction(props.ideaId, true);
          if (r.ok && r.postId) { setMsg('drafted thread'); router.push(`/admin/social/posts/${r.postId}`); }
          else setMsg(r.error ?? 'error');
        })}
      >Draft as thread</button>
      {msg && <span className="col-dim" style={{ fontSize: 10, maxWidth: 180 }}>{msg}</span>}
    </div>
  );
}

export function PostActions(props: { postId: string; status: string; mode: 'editor' }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  void props.mode;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {props.status === 'draft' && (
        <button
          className={`status-badge ${pending ? 'status-not_connected' : 'status-approved'}`}
          disabled={pending}
          style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
          onClick={() => start(async () => { const r = await approvePostAction(props.postId); setMsg(r.ok ? 'approved' : r.error ?? 'error'); })}
        >Approve</button>
      )}
      {props.status !== 'cancelled' && props.status !== 'published' && (
        <button
          className="status-badge status-rejected"
          disabled={pending}
          style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
          onClick={() => start(async () => {
            const reason = window.prompt('Cancel reason?') ?? '';
            if (!reason) return;
            const r = await cancelPostAction(props.postId, reason);
            setMsg(r.ok ? 'cancelled' : r.error ?? 'error');
          })}
        >Cancel</button>
      )}
      <button
        className="status-badge status-info"
        disabled={pending}
        style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
        onClick={() => start(async () => {
          const r = await publishPostAction(props.postId, 'dry_run');
          const result = r.result as { payload?: unknown; error?: string } | undefined;
          setMsg(r.ok ? `dry-run payload: ${JSON.stringify(result?.payload ?? {}).slice(0, 180)}` : r.error ?? 'error');
        })}
      >Dry-run payload</button>
      {props.status === 'approved' && (
        <button
          className="status-badge status-opportunity"
          disabled={pending}
          style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
          onClick={() => {
            if (!window.confirm('LIVE publish to X? This posts publicly from the approved account.')) return;
            start(async () => {
              const r = await publishPostAction(props.postId, 'live');
              setMsg(r.ok ? 'posted live' : r.error ?? 'error');
            });
          }}
        >Publish live</button>
      )}
      {msg && <span className="col-dim" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}
