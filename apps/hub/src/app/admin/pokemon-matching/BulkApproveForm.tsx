'use client';

import { useEffect, useState, useTransition } from 'react';
import { bulkApproveDryRun, bulkApproveStart, bulkApproveTick, bulkApproveCancel } from './actions';

interface Props {
  initialEligible: number;
}

type EligFilter = 'bulk_safe' | 'market_only' | 'identity_only';

export default function BulkApproveForm({ initialEligible }: Props) {
  const [isPending, startTransition] = useTransition();
  const [eligibility, setEligibility] = useState<EligFilter>('bulk_safe');
  const [language, setLanguage] = useState<'all' | 'en' | 'jp'>('all');
  const [limitTotal, setLimitTotal] = useState<number>(100);
  const [preview, setPreview] = useState<{ total_eligible?: number; preview?: Array<{ pp_card_slug: string; pp_card_name: string | null; tcg_name: string | null; pricing_eligibility: string | null }>; message?: string; error?: string } | null>(null);

  const [activeBatch, setActiveBatch] = useState<{ id: string; approved: number; total: number; remaining: number; last_slug: string | null; state: string } | null>(null);
  const [finalMsg, setFinalMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPreview = () => startTransition(async () => {
    const res = await bulkApproveDryRun({ pricing_eligibility: eligibility, language });
    if (!res.ok) { setError(res.error ?? 'error'); setPreview(null); return; }
    setError(null);
    setPreview(res);
  });

  const onStart = () => startTransition(async () => {
    const n = preview?.total_eligible ?? 0;
    if (n === 0) { setError('nothing to approve'); return; }
    if (!confirm(
      `Start bulk-approve of ${Math.min(n, limitTotal).toLocaleString()} rows ` +
      `with pricing_eligibility=${eligibility}` +
      (language !== 'all' ? ` (${language} only)` : '') +
      `?\n\nThis writes approvals + audit rows in 500-row batches. ` +
      `Does NOT change live pricing.`,
    )) return;

    const res = await bulkApproveStart({ pricing_eligibility: eligibility, language, limit_total: limitTotal });
    if (!res.ok || !res.batch_id) { setError(res.error ?? 'start failed'); return; }
    setError(null);
    setFinalMsg(null);
    setActiveBatch({ id: res.batch_id, approved: 0, total: res.total_eligible ?? 0, remaining: res.rows_remaining ?? 0, last_slug: null, state: 'running' });
  });

  const onCancel = () => startTransition(async () => {
    if (!activeBatch) return;
    if (!confirm('Cancel this bulk-approval run? Already-approved rows will remain approved.')) return;
    const res = await bulkApproveCancel(activeBatch.id);
    if (!res.ok) setError(res.error ?? 'cancel failed');
    setActiveBatch(prev => prev ? { ...prev, state: 'cancelled' } : null);
  });

  // Tick the active batch until completion
  useEffect(() => {
    if (!activeBatch || activeBatch.state !== 'running') return;
    const timer = setTimeout(async () => {
      const res = await bulkApproveTick(activeBatch.id);
      if (!res.ok) {
        setError(res.error ?? 'tick failed');
        setActiveBatch(prev => prev ? { ...prev, state: 'failed' } : null);
        return;
      }
      const nextState = res.state ?? 'running';
      setActiveBatch({
        id: activeBatch.id,
        approved: res.rows_approved ?? 0,
        total: res.total_eligible ?? activeBatch.total,
        remaining: res.rows_remaining ?? 0,
        last_slug: res.last_pp_slug ?? null,
        state: nextState,
      });
      if (nextState === 'completed') {
        setFinalMsg(res.message ?? 'batch completed');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [activeBatch]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13 }}>
        <strong>{initialEligible.toLocaleString()}</strong> rows currently have review_status=pending_review +
        confidence=verified. Only rows with pricing_eligibility=<code>bulk_safe</code> are safe to bulk-approve
        for Phase-8 price activation. Variant printings (<code>market_only</code>) and clash/promo rows
        (<code>identity_only</code>) must be reviewed manually before any price can be activated.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>Pricing eligibility</span>
          <select
            value={eligibility}
            onChange={(e) => setEligibility(e.target.value as EligFilter)}
            className="ui-select"
            disabled={isPending || !!activeBatch}
          >
            <option value="bulk_safe">bulk_safe (recommended)</option>
            <option value="market_only">market_only (variants; identity only)</option>
            <option value="identity_only">identity_only (never activate prices)</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as any)} className="ui-select" disabled={isPending || !!activeBatch}>
            <option value="all">Both</option>
            <option value="en">English only</option>
            <option value="jp">Japanese only</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>Max rows this run</span>
          <input
            type="number"
            value={limitTotal}
            min={1}
            step={100}
            onChange={(e) => setLimitTotal(Math.max(1, Number(e.target.value) || 100))}
            className="ui-input"
            disabled={isPending || !!activeBatch}
            style={{ width: 120 }}
          />
        </label>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={onPreview} disabled={isPending || !!activeBatch}>
          {isPending ? 'Loading…' : 'Preview'}
        </button>
        <button type="button" className="ui-btn ui-btn--primary" onClick={onStart} disabled={isPending || !preview?.total_eligible || !!activeBatch}>
          {activeBatch ? 'Running…' : 'Start bulk approve'}
        </button>
        {activeBatch?.state === 'running' && (
          <button type="button" className="ui-btn ui-btn--danger" onClick={onCancel} disabled={isPending}>Cancel</button>
        )}
      </div>

      {preview && !activeBatch && (
        <div style={{ fontSize: 13, padding: 10, background: '#f1f8f1', border: '1px solid #cfe3cf', borderRadius: 4 }}>
          <strong>Dry run:</strong> {preview.total_eligible?.toLocaleString()} rows match pricing_eligibility={eligibility}
          {language !== 'all' && ` (${language})`}. Will approve up to {Math.min(preview.total_eligible ?? 0, limitTotal).toLocaleString()} this run.
          {preview.preview && preview.preview.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Sample (first 20):</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11 }}>
                {preview.preview.map((p) => (
                  <li key={p.pp_card_slug}>
                    [{p.pricing_eligibility}] {p.pp_card_name || p.pp_card_slug} → {p.tcg_name || '(no name)'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {activeBatch && (
        <div style={{ fontSize: 13, padding: 10, background: activeBatch.state === 'failed' ? '#fdf1f1' : '#eaf3fb', border: '1px solid #c0d7e5', borderRadius: 4 }}>
          <div><strong>Batch {activeBatch.id.slice(0, 8)}</strong> · state: {activeBatch.state}</div>
          <div style={{ marginTop: 6 }}>
            Approved: <strong>{activeBatch.approved.toLocaleString()}</strong> / {activeBatch.total.toLocaleString()}
            {activeBatch.remaining > 0 && ` · remaining: ${activeBatch.remaining.toLocaleString()}`}
          </div>
          <div style={{ marginTop: 6, height: 6, background: '#e0e0e0', borderRadius: 3 }}>
            <div style={{
              width: `${Math.min(100, (activeBatch.approved / Math.max(1, activeBatch.total)) * 100)}%`,
              height: '100%',
              background: activeBatch.state === 'failed' ? '#c0392b' : '#27ae60',
              borderRadius: 3,
              transition: 'width 300ms ease',
            }} />
          </div>
          {activeBatch.last_slug && (
            <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>last processed slug: {activeBatch.last_slug}</div>
          )}
          {finalMsg && <div style={{ marginTop: 8, fontWeight: 600, color: '#1a5c1a' }}>{finalMsg}</div>}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 13, padding: 10, background: '#fdf1f1', border: '1px solid #e5c0c0', borderRadius: 4, color: '#8b1a1a' }}>
          Error: {error}
        </div>
      )}
    </div>
  );
}
