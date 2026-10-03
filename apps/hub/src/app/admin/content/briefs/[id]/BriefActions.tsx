'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveBriefAction, rejectBriefAction, createArticleFromBriefAction } from '../actions';

export function BriefActions(props: { briefId: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  if (props.status === 'rejected') return <span className="col-dim">rejected</span>;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {props.status === 'in_review' && (
        <>
          <button
            className={`status-badge ${pending ? 'status-not_connected' : 'status-approved'}`}
            disabled={pending}
            style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11, padding: '6px 10px' }}
            onClick={() => start(async () => {
              const r = await approveBriefAction(props.briefId);
              setMsg(r.ok ? 'approved' : (r.error ?? 'error'));
            })}
          >{pending ? 'Approving…' : 'Approve brief'}</button>
          <button
            className="status-badge status-rejected"
            style={{ cursor: 'pointer', border: 'none', fontSize: 11, padding: '6px 10px' }}
            onClick={() => start(async () => {
              const reason = window.prompt('Reason for rejection?') ?? '';
              if (!reason) return;
              const r = await rejectBriefAction(props.briefId, reason);
              setMsg(r.ok ? 'rejected' : (r.error ?? 'error'));
            })}
          >Reject</button>
        </>
      )}
      {props.status === 'approved' && (
        <button
          className={`status-badge ${pending ? 'status-not_connected' : 'status-opportunity'}`}
          disabled={pending}
          style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11, padding: '6px 10px' }}
          onClick={() => start(async () => {
            const r = await createArticleFromBriefAction(props.briefId);
            if (r.ok && r.articleId) router.push(`/admin/content/articles/${r.articleId}`);
            else setMsg(r.error ?? 'error');
          })}
        >{pending ? 'Creating…' : 'Create article from brief'}</button>
      )}
      {msg && <span className="col-dim" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}
