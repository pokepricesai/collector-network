// Shared admin UI primitives. Deliberately dense and functional —
// this is the inside of the OS, not a landing page. Server-safe
// unless marked otherwise.

import type { ReactNode } from 'react';

export function SectionHeader(props: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-section-head">
      <div>
        {props.eyebrow && <div className="admin-eyebrow">{props.eyebrow}</div>}
        <h1 className="admin-h1">{props.title}</h1>
        {props.description && (
          <p className="admin-section-desc">{props.description}</p>
        )}
      </div>
      {props.actions && <div className="admin-section-actions">{props.actions}</div>}
    </header>
  );
}

export function MetricCard(props: {
  label: string;
  value?: string | number | null;
  helper?: string;
  state?: 'ok' | 'muted' | 'not-connected' | 'no-data';
}) {
  const state = props.state ?? (props.value == null ? 'no-data' : 'ok');
  const display =
    state === 'not-connected' ? 'Not connected' :
    state === 'no-data' ? 'No data yet' :
    props.value;
  return (
    <div className="metric-card">
      <div className="metric-label">{props.label}</div>
      <div className={`metric-value metric-value--${state}`}>{display}</div>
      {props.helper && <div className="metric-helper">{props.helper}</div>}
    </div>
  );
}

export function StatusBadge(props: {
  state:
    | 'active' | 'parked' | 'planned' | 'archived'
    | 'connected' | 'not_connected' | 'needs_configuration' | 'error' | 'disabled'
    | 'open' | 'in_progress' | 'waiting' | 'completed' | 'dismissed'
    | 'acknowledged' | 'resolved' | 'suppressed'
    | 'running' | 'success' | 'warning' | 'failed'
    | 'critical' | 'high' | 'normal' | 'low'
    | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'executed'
    | 'ok' | 'opportunity' | 'info'
    | 'owner' | 'admin' | 'editor' | 'viewer';
  label?: string;
}) {
  const label = props.label ?? props.state.replace(/_/g, ' ');
  return <span className={`status-badge status-${props.state}`}>{label}</span>;
}

export function EmptyState(props: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'muted';
}) {
  return (
    <div className={`admin-empty admin-empty--${props.tone ?? 'default'}`}>
      <div className="admin-empty-title">{props.title}</div>
      {props.description && <div className="admin-empty-desc">{props.description}</div>}
      {props.action && <div className="admin-empty-action">{props.action}</div>}
    </div>
  );
}

export function Panel(props: {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-panel">
      {(props.title || props.actions) && (
        <header className="admin-panel-head">
          <div>
            {props.eyebrow && <div className="admin-eyebrow">{props.eyebrow}</div>}
            {props.title && <h2 className="admin-h2">{props.title}</h2>}
          </div>
          {props.actions && <div>{props.actions}</div>}
        </header>
      )}
      <div className="admin-panel-body">{props.children}</div>
    </section>
  );
}

export function Table<T extends { id?: string | number }>(props: {
  columns: Array<{ key: string; header: string; className?: string; render: (row: T) => ReactNode }>;
  rows: T[];
  empty?: ReactNode;
}) {
  if (props.rows.length === 0) {
    return <div className="admin-table-empty">{props.empty ?? 'Nothing to show yet.'}</div>;
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th key={c.key} className={c.className}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {props.columns.map((c) => (
                <td key={c.key} className={c.className}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FilterBar(props: { children: ReactNode }) {
  return <div className="admin-filter-bar">{props.children}</div>;
}
