'use client';

import { useState, useTransition } from 'react';
import { setSampleVerdict } from './actions';

interface Props {
  sampleId: string;
  currentPassed: boolean | null;
  currentReason: string | null;
  previewUrl: string;
}

export default function SamplePassFail({ sampleId, currentPassed, currentReason, previewUrl }: Props) {
  const [isPending, startTransition] = useTransition();
  const [passed, setPassed] = useState<boolean | null>(currentPassed);
  const [reason, setReason] = useState<string>(currentReason ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const commit = (next: boolean | null) => startTransition(async () => {
    const res = await setSampleVerdict(sampleId, next, reason || null);
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'error' }); return; }
    setPassed(next);
    setMsg({ ok: true, text: next === null ? 'cleared' : next ? 'passed' : 'failed' });
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <a href={previewUrl} target="_blank" rel="noreferrer" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ fontSize: 11 }}>Preview ↗</a>
        <button
          type="button"
          onClick={() => commit(true)}
          disabled={isPending}
          className={passed === true ? 'ui-btn ui-btn--primary ui-btn--sm' : 'ui-btn ui-btn--secondary ui-btn--sm'}
          style={{ fontSize: 11 }}
        >✓ Pass</button>
        <button
          type="button"
          onClick={() => commit(false)}
          disabled={isPending}
          className={passed === false ? 'ui-btn ui-btn--danger ui-btn--sm' : 'ui-btn ui-btn--secondary ui-btn--sm'}
          style={{ fontSize: 11 }}
        >✗ Fail</button>
        {passed !== null && (
          <button
            type="button"
            onClick={() => commit(null)}
            disabled={isPending}
            className="ui-btn ui-btn--ghost ui-btn--sm"
            style={{ fontSize: 11 }}
          >Clear</button>
        )}
      </div>
      {passed === false && (
        <input
          type="text"
          placeholder="reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => commit(false)}
          className="ui-input"
          style={{ fontSize: 11 }}
        />
      )}
      {msg && (
        <div style={{
          fontSize: 10, padding: '2px 4px', borderRadius: 2,
          color: msg.ok ? '#1a5c1a' : '#8b1a1a',
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
