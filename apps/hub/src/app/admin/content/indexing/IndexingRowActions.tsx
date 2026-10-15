'use client';

import { useState, useTransition } from 'react';
import { markGoogleIndexRequestedAction, submitBingIndexNowAction } from '../articles/actions';

export function IndexingRowActions(props: { articleId: string; googleDone: boolean; bingDone: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          className="status-badge status-approved"
          disabled={pending || props.googleDone}
          style={{ fontSize: 11, border: 'none', cursor: pending || props.googleDone ? 'default' : 'pointer' }}
          onClick={() => start(async () => {
            const r = await markGoogleIndexRequestedAction(props.articleId, true);
            setMsg(r.ok ? 'Google ✓' : r.error ?? 'error');
          })}
        >{props.googleDone ? 'Google ✓' : 'Mark Google requested'}</button>
        <button
          className="status-badge status-approved"
          disabled={pending || props.bingDone}
          style={{ fontSize: 11, border: 'none', cursor: pending || props.bingDone ? 'default' : 'pointer' }}
          onClick={() => start(async () => {
            const r = await submitBingIndexNowAction(props.articleId);
            setMsg(r.ok ? `Bing · HTTP ${r.status}` : r.skipped ? `skipped: ${r.skipped}` : r.error ?? 'error');
          })}
        >{props.bingDone ? 'Bing ✓' : 'Submit Bing'}</button>
      </div>
      {msg && <span className="col-dim" style={{ fontSize: 10 }}>{msg}</span>}
    </div>
  );
}
