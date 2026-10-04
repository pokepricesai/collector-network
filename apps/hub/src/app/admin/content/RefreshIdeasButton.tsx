'use client';

import { useState, useTransition } from 'react';
import { regenerateRefreshIdeasAction } from '@/app/admin/social/actions';

export function RefreshIdeasButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        className={`status-badge ${pending ? 'status-not_connected' : 'status-opportunity'}`}
        disabled={pending}
        style={{ cursor: pending ? 'not-allowed' : 'pointer', border: 'none', fontSize: 11 }}
        onClick={() => start(async () => {
          const r = await regenerateRefreshIdeasAction();
          setMsg(r.per_site.map((s) => `${s.site}: +${s.generated}/~${s.refreshed}/x${s.dismissed_stale}`).join(' · '));
        })}
      >{pending ? 'Scanning…' : 'Scan for refresh candidates'}</button>
      {msg && <span className="col-dim" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}
