'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  approveIdeaAction,
  dismissIdeaAction,
  generateBriefForIdeaAction,
  regenerateAllIdeasAction,
} from './actions';

export function RegenerateIdeasButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        className={`status-badge ${pending ? 'status-not_connected' : 'status-opportunity'}`}
        disabled={pending}
        style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
        onClick={() => start(async () => {
          const r = await regenerateAllIdeasAction();
          const summary = r.perSite.map((s) => `${s.site}: +${s.generated}${s.shortfall ? ` (short ${s.shortfall})` : ''}/~${s.refreshed}/x${s.dismissed_stale}`).join(' · ');
          const shortNote = r.totalShortfall > 0 ? ` · ⚠ ${r.totalShortfall} short of weekly target (evidence insufficient)` : '';
          setMsg(summary + shortNote);
        })}
      >{pending ? 'Running…' : 'Regenerate from Phase 2'}</button>
      {msg && <span className="col-dim" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}

export function IdeaRowActions(props: { ideaId: string; status: string; holdReasons: string[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);

  const budgetWaiting = props.holdReasons.includes('budget_waiting');
  const briefFailed = props.holdReasons.includes('brief_failed');
  const draftFailed = props.holdReasons.includes('draft_failed');

  // Approved + already pipelined: show link to article (if we know
  // it) and the hold-reason badge.
  if (props.status === 'approved' || props.status === 'in_brief') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
        {budgetWaiting && <span className="status-badge status-pending" style={{ fontSize: 10 }}>Budget Waiting</span>}
        {briefFailed && <span className="status-badge status-not_connected" style={{ fontSize: 10 }}>brief failed · will retry</span>}
        {draftFailed && <span className="status-badge status-not_connected" style={{ fontSize: 10 }}>draft failed · will retry</span>}
        {!budgetWaiting && !briefFailed && !draftFailed && (
          <button
            className={`status-badge ${pending ? 'status-not_connected' : 'status-opportunity'}`}
            disabled={pending}
            style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
            onClick={() => start(async () => {
              const r = await generateBriefForIdeaAction(props.ideaId);
              setMsg(r.ok ? 'brief created' : (r.error ?? 'error'));
            })}
          >{pending ? 'Generating…' : 'Regen brief'}</button>
        )}
        {articleId && <Link className="status-badge status-active" style={{ fontSize: 11 }} href={`/admin/content/articles/${articleId}`}>Open article →</Link>}
        {msg && <span className="col-dim" style={{ fontSize: 10, maxWidth: 220 }}>{msg}</span>}
      </div>
    );
  }

  if (props.status === 'drafting') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
        <span className="status-badge status-active" style={{ fontSize: 10 }}>drafted</span>
      </div>
    );
  }

  // New → Approve / Edit / Reject.
  if (props.status === 'new') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`status-badge ${pending ? 'status-not_connected' : 'status-approved'}`}
            disabled={pending}
            style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
            title="Approve → auto-generate brief + draft within the $1/7d budget"
            onClick={() => start(async () => {
              const r = await approveIdeaAction(props.ideaId);
              setMsg(r.message ?? (r.ok ? 'approved' : (r.error ?? 'error')));
              if (r.articleId) setArticleId(r.articleId);
            })}
          >{pending ? 'Drafting…' : 'Approve & draft'}</button>
          <Link
            className="status-badge status-not_connected"
            style={{ fontSize: 11, textDecoration: 'none' }}
            href={`/admin/content/ideas/${props.ideaId}`}
          >Edit</Link>
          <button
            className="status-badge status-not_connected"
            style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
            onClick={() => start(async () => {
              const reason = window.prompt('Reason for rejection?') ?? '';
              if (!reason) return;
              await dismissIdeaAction(props.ideaId, reason);
              setMsg('rejected');
            })}
          >Reject</button>
        </div>
        {articleId && <Link className="status-badge status-active" style={{ fontSize: 11, marginTop: 2 }} href={`/admin/content/articles/${articleId}`}>Open article →</Link>}
        {msg && <span className="col-dim" style={{ fontSize: 10, maxWidth: 260 }}>{msg}</span>}
      </div>
    );
  }

  return <span className="col-dim" style={{ fontSize: 11 }}>{props.status}</span>;
}
