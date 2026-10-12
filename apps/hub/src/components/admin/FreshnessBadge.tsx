import type { ReactNode } from 'react';

// Deterministic Fresh / Aging / Stale badge used by Morning Brief,
// Health page, Intelligence overview and the Dashboard freshness
// strip. The caller passes thresholds in hours — different sources
// have different tolerances (GA4 can lag 1–2d; Intelligence should
// refresh daily).

export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'never';

export interface FreshnessOpts {
  freshHours: number;    // ≤ this → fresh
  agingHours: number;    // ≤ this → aging; beyond → stale
}

export function freshnessState(iso: string | null | undefined, opts: FreshnessOpts): FreshnessState {
  if (!iso) return 'never';
  const ageHours = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
  if (ageHours <= opts.freshHours) return 'fresh';
  if (ageHours <= opts.agingHours) return 'aging';
  return 'stale';
}

export function relativeLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function FreshnessBadge({
  state,
  label,
}: {
  state: FreshnessState;
  label?: ReactNode;
}) {
  const color =
    state === 'fresh' ? 'var(--success, #2a9f58)' :
    state === 'aging' ? 'var(--warning, #e67e22)' :
    state === 'stale' ? 'var(--failed, #c0392b)' :
                        'var(--admin-text-muted, #6b7280)';
  const text =
    state === 'fresh' ? 'Fresh' :
    state === 'aging' ? 'Aging' :
    state === 'stale' ? 'Stale' :
                        'Never';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      border: `1px solid ${color}`, color, background: 'transparent',
      letterSpacing: '0.03em',
    }}>
      <span style={{ textTransform: 'uppercase' }}>{text}</span>
      {label && <span style={{ fontWeight: 400, letterSpacing: 0 }}>· {label}</span>}
    </span>
  );
}
