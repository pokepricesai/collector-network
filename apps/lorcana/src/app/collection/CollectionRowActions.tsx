'use client';

import { useState, useTransition } from 'react';
import { deleteCollectionAction } from './actions';

// Minimal per-row action: delete. Edit lives on a follow-up pass —
// most users will delete + re-add during the parity phase.

export function CollectionRowActions({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await deleteCollectionAction(id);
            if (!r.ok && !r.tableMissing) setErr(r.error ?? 'Delete failed');
          })
        }
        style={{
          padding: '6px 10px',
          background: 'transparent',
          border: '1px solid var(--border-strong, var(--border))',
          color: 'var(--text-muted)',
          borderRadius: 8,
          cursor: pending ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {pending ? 'Removing…' : 'Remove'}
      </button>
      {err && <span style={{ fontSize: 11, color: '#8a1c1f' }}>{err}</span>}
    </div>
  );
}
