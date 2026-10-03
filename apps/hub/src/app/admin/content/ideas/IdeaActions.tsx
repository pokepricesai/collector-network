'use client';

import { useState, useTransition } from 'react';
import { dismissIdeaAction, generateBriefForIdeaAction, regenerateAllIdeasAction } from './actions';

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
          const summary = r.perSite.map((s) => `${s.site}: +${s.generated}/~${s.refreshed}/x${s.dismissed_stale}`).join(' · ');
          setMsg(summary);
        })}
      >{pending ? 'Running…' : 'Regenerate from Phase 2'}</button>
      {msg && <span className="col-dim" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}

export function IdeaRowActions(props: { ideaId: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (props.status !== 'new') {
    return <span className="col-dim" style={{ fontSize: 11 }}>{props.status}</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <button
        className={`status-badge ${pending ? 'status-not_connected' : 'status-opportunity'}`}
        disabled={pending}
        style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
        onClick={() => start(async () => {
          const r = await generateBriefForIdeaAction(props.ideaId);
          setMsg(r.ok ? 'brief created' : (r.error ?? 'error'));
        })}
      >{pending ? 'Generating…' : 'Generate brief (AI)'}</button>
      <button
        className="status-badge status-not_connected"
        style={{ cursor: 'pointer', border: 'none', fontSize: 10 }}
        onClick={() => start(async () => {
          const reason = window.prompt('Reason for dismissal?') ?? '';
          if (!reason) return;
          await dismissIdeaAction(props.ideaId, reason);
          setMsg('dismissed');
        })}
      >Dismiss</button>
      {msg && <span className="col-dim" style={{ fontSize: 10, maxWidth: 220 }}>{msg}</span>}
    </div>
  );
}
