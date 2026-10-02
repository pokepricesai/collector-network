// Format helpers for admin surfaces. Deliberately boring.

export function formatInt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-GB');
}

export function formatFloat(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—';
  return n.toFixed(digits);
}

export function formatPct(ratio: number | null | undefined, digits = 2): string {
  if (ratio == null || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDelta(curr: number, prior: number): { label: string; sign: 'up' | 'down' | 'flat' } {
  if (prior === 0) {
    if (curr === 0) return { label: '—', sign: 'flat' };
    return { label: '▲ new', sign: 'up' };
  }
  const delta = (curr - prior) / prior;
  if (Math.abs(delta) < 0.005) return { label: '—', sign: 'flat' };
  const pct = Math.abs(delta * 100);
  const sign = delta > 0 ? '▲' : '▼';
  return {
    label: `${sign} ${pct.toFixed(1)}%`,
    sign: delta > 0 ? 'up' : 'down',
  };
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'moments ago';
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export function formatDateOnly(d: Date | string | null): string {
  if (!d) return '—';
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}
