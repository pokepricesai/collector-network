import type { ReactNode } from 'react';

// Single compact empty-state line. Replaces stacks like
//   section header + large empty box + blue info box
// that previously said the same thing three times. Caller uses it
// INSIDE a panel body — not as a replacement for the whole panel.

export function EmptyPanelNotice({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: '10px 14px',
      border: '1px dashed var(--admin-border)',
      borderRadius: 'var(--radius-md)',
      background: 'transparent',
      color: 'var(--admin-text-muted)',
      fontSize: 13,
      lineHeight: 1.4,
    }}>
      {children}
    </div>
  );
}
