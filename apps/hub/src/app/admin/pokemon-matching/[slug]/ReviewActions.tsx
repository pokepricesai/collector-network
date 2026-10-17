'use client';

import { useState, useTransition } from 'react';
import { approveCurrentMapping, reassignToCandidate, rejectMapping, undoMapping } from '../actions';
import type { MappingRow, CandidateRow } from '@/server/pokemon-matching/queries';

interface Props {
  mapping: MappingRow;
  candidates: CandidateRow[];
}

export default function ReviewActions({ mapping, candidates }: Props) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<string>(candidates[0]?.id || '');

  const show = (ok: boolean, text: string) => setMsg({ ok, text });

  const onApprove = () => startTransition(async () => {
    const res = await approveCurrentMapping(mapping.pp_card_slug);
    show(!!res.ok, res.ok ? (res.message || 'approved') : (res.error || 'error'));
  });

  const onReassign = () => startTransition(async () => {
    if (!selectedCandidate) return;
    const res = await reassignToCandidate(mapping.pp_card_slug, selectedCandidate);
    show(!!res.ok, res.ok ? (res.message || 'reassigned') : (res.error || 'error'));
  });

  const onReject = (kind: 'rejected' | 'no_tcg_equivalent') => startTransition(async () => {
    const res = await rejectMapping(mapping.pp_card_slug, { kind });
    show(!!res.ok, res.ok ? (res.message || 'done') : (res.error || 'error'));
  });

  const onUndo = () => startTransition(async () => {
    const res = await undoMapping(mapping.pp_card_slug);
    show(!!res.ok, res.ok ? (res.message || 'undone') : (res.error || 'error'));
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
      <button className="ui-btn ui-btn--primary ui-btn--sm" onClick={onApprove} disabled={isPending || !mapping.tcg_card_id}>
        Approve current
      </button>

      {candidates.length > 1 && (
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            className="ui-select"
            value={selectedCandidate}
            onChange={(e) => setSelectedCandidate(e.target.value)}
            disabled={isPending}
            style={{ flex: 1, fontSize: 12 }}
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.tcg_name} · {c.tcg_set_code} · {c.tcg_printing_key} · {c.confidence}
              </option>
            ))}
          </select>
          <button className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onReassign} disabled={isPending}>
            Reassign
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onReject('rejected')} disabled={isPending} style={{ flex: 1 }}>
          Reject
        </button>
        <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onReject('no_tcg_equivalent')} disabled={isPending} style={{ flex: 1 }}>
          No equivalent
        </button>
      </div>

      {mapping.previous_review_status && (
        <button className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onUndo} disabled={isPending}>
          Undo (restore to {mapping.previous_review_status.replace(/_/g, ' ')})
        </button>
      )}

      {msg && (
        <div style={{
          fontSize: 11,
          padding: 6,
          borderRadius: 3,
          background: msg.ok ? '#f1f8f1' : '#fdf1f1',
          border: `1px solid ${msg.ok ? '#cfe3cf' : '#e5c0c0'}`,
          color: msg.ok ? '#1a5c1a' : '#8b1a1a',
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
