'use client';

import { useState, useTransition } from 'react';
import { createTaskFromOpportunity, dismissOpportunity } from './actions';
import Link from 'next/link';

interface Props {
  opportunityId: string;
  status: 'open' | 'actioned' | 'dismissed' | 'stale';
  taskId: string | null;
}

export function OpportunityActions({ opportunityId, status, taskId }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === 'actioned' && taskId) {
    return (
      <Link className="status-badge status-completed" href={`/admin/tasks#${taskId}`}>
        Task ↗
      </Link>
    );
  }
  if (status === 'dismissed') {
    return <span className="status-badge status-dismissed">Dismissed</span>;
  }
  if (status === 'stale') {
    return <span className="status-badge status-suppressed">Stale</span>;
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        className="status-badge status-active"
        style={{ border: 'none', cursor: pending ? 'wait' : 'pointer' }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await createTaskFromOpportunity(opportunityId);
            if (!r.ok) setError(r.error ?? 'failed');
          })
        }
      >
        Create task
      </button>
      <button
        type="button"
        className="status-badge status-not_connected"
        style={{ border: 'none', cursor: pending ? 'wait' : 'pointer' }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const reason = window.prompt('Dismiss reason (shown in audit log)') ?? '';
            if (!reason) return;
            setError(null);
            const r = await dismissOpportunity(opportunityId, reason);
            if (!r.ok) setError(r.error ?? 'failed');
          })
        }
      >
        Dismiss
      </button>
      {error && <span style={{ color: '#8A1C27', fontSize: 11 }}>{error}</span>}
    </div>
  );
}
