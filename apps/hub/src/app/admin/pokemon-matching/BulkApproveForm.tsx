'use client';

import { useState, useTransition } from 'react';
import { bulkApproveVerified } from './actions';

interface Props {
  initialEligible: number;
}

export default function BulkApproveForm({ initialEligible }: Props) {
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ ok: boolean; preview?: Array<{ pp_card_slug: string; pp_card_name: string | null; tcg_name: string | null }>; total_eligible?: number; message?: string; error?: string; affected?: number } | null>(null);
  const [language, setLanguage] = useState<'all' | 'en' | 'jp'>('all');

  const onPreview = () => {
    startTransition(async () => {
      const res = await bulkApproveVerified({ dryRun: true, language });
      setPreview(res as any);
    });
  };

  const onApprove = () => {
    const n = preview?.total_eligible ?? initialEligible;
    if (!confirm(`Bulk-approve ${n.toLocaleString()} verified pending mappings? This writes approvals but does NOT change live pricing.`)) return;
    startTransition(async () => {
      const res = await bulkApproveVerified({ dryRun: false, language });
      setPreview(res as any);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13 }}>
        <strong>{initialEligible.toLocaleString()}</strong> pending mappings have confidence=verified and are eligible for one-click
        bulk approval. "Verified" means the matcher found exactly one high-confidence TCGGraph candidate at the exact
        set + collector number + card name + printing key.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>Language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'all' | 'en' | 'jp')}
            className="ui-select"
            disabled={isPending}
          >
            <option value="all">Both</option>
            <option value="en">English only</option>
            <option value="jp">Japanese only</option>
          </select>
        </label>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={onPreview} disabled={isPending}>
          {isPending ? 'Loading…' : 'Preview'}
        </button>
        <button type="button" className="ui-btn ui-btn--primary" onClick={onApprove} disabled={isPending}>
          {isPending ? 'Approving…' : 'Approve all verified pending'}
        </button>
      </div>

      {preview?.ok && preview.message && (
        <div style={{ fontSize: 13, padding: 10, background: '#f1f8f1', border: '1px solid #cfe3cf', borderRadius: 4 }}>
          <strong>{preview.message}</strong>
          {typeof preview.affected === 'number' && <> · affected={preview.affected.toLocaleString()}</>}
          {typeof preview.total_eligible === 'number' && <> · eligible={preview.total_eligible.toLocaleString()}</>}
          {preview.preview && preview.preview.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Sample (first 20):</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11 }}>
                {preview.preview.map((p) => (
                  <li key={p.pp_card_slug}>
                    {p.pp_card_name || p.pp_card_slug} → {p.tcg_name || '(no name)'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {preview?.ok === false && (
        <div style={{ fontSize: 13, padding: 10, background: '#fdf1f1', border: '1px solid #e5c0c0', borderRadius: 4, color: '#8b1a1a' }}>
          Error: {preview.error}
        </div>
      )}
    </div>
  );
}
