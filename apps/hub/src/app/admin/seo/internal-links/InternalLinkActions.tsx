'use client';

import { useState, useTransition } from 'react';
import { createTaskFromInternalLinkOpportunity, dismissInternalLinkOpportunity } from './actions';

export function InternalLinkActions(props: { opportunityId: string; status: string; taskId: string | null }) {
  const [, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (props.status !== 'open') {
    return <span className="col-dim" style={{ fontSize: 11 }}>{props.status}{props.taskId ? ' · tracked' : ''}</span>;
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
      <button
        className="status-badge status-opportunity"
        style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
        onClick={() => start(async () => {
          const r = await createTaskFromInternalLinkOpportunity(props.opportunityId);
          setMsg(r.ok ? 'tracked' : r.error ?? 'error');
        })}
      >Create task</button>
      <button
        className="status-badge status-not_connected"
        style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
        onClick={() => start(async () => {
          const r = await dismissInternalLinkOpportunity(props.opportunityId);
          setMsg(r.ok ? 'dismissed' : r.error ?? 'error');
        })}
      >Dismiss</button>
      {msg && <span className="col-dim" style={{ fontSize: 10 }}>{msg}</span>}
    </div>
  );
}
