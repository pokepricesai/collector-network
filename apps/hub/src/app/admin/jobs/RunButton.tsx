'use client';

import { useState, useTransition } from 'react';
import { runAdminJob } from './actions';

export function RunButton(props: {
  slug: string;
  label: string;
  requiresConfirmation?: boolean;
  confirmPrompt?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function go(confirmedParam: boolean) {
    setMsg('Running…');
    const r = await runAdminJob(props.slug, confirmedParam);
    if (!r.ok) setMsg(`Error: ${r.error ?? 'unknown'}`);
    else {
      const dur = r.result?.durationMs ?? 0;
      const inserted = r.result?.rowsInserted ?? 0;
      const updated = r.result?.rowsUpdated ?? 0;
      setMsg(`Done in ${(dur / 1000).toFixed(1)}s · +${inserted} / ~${updated}`);
    }
  }

  function onClick() {
    if (props.requiresConfirmation && !confirmed) {
      const sure = window.confirm(props.confirmPrompt ?? `Run "${props.label}" now? This may incur BigQuery scan cost.`);
      if (!sure) return;
      setConfirmed(true);
      start(() => go(true));
      return;
    }
    start(() => go(true));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <button
        disabled={pending}
        onClick={onClick}
        className={`status-badge ${pending ? 'status-not_connected' : 'status-opportunity'}`}
        style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11, padding: '4px 10px' }}
      >{pending ? 'Running…' : 'Run now'}</button>
      {msg && <span className="col-dim" style={{ fontSize: 10, maxWidth: 220, textAlign: 'right' }}>{msg}</span>}
    </div>
  );
}
