'use client';

// Admin-scope error boundary. Catches render errors in any
// /admin/* route and surfaces the specific message instead of the
// generic Next "Application error" overlay. Keep it minimal — this
// is a diagnostic surface, not a styled fallback.

import { useEffect } from 'react';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to browser console so it also shows up in Vercel's
    // runtime logs on first hydration.
    // eslint-disable-next-line no-console
    console.error('[admin/error]', error);
  }, [error]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 760, margin: '0 auto', color: '#1a1a1a' }}>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Admin render error</h1>
      <p style={{ fontSize: 13, color: '#555' }}>
        A page in <code>/admin</code> threw during render. The data has not been changed — this is a UI problem.
      </p>
      <pre style={{ fontSize: 12, background: '#FAFAFA', border: '1px solid #E6E6E6', borderRadius: 4, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ''}
      </pre>
      <div style={{ display: 'inline-flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{ cursor: 'pointer', border: '1px solid #D4D4D4', background: '#fff', padding: '6px 12px', borderRadius: 4, fontSize: 13 }}
        >
          Try again
        </button>
        <a
          href="/admin"
          style={{ padding: '6px 12px', borderRadius: 4, fontSize: 13, textDecoration: 'none', background: '#1a1a1a', color: '#fff' }}
        >
          Back to admin
        </a>
      </div>
    </div>
  );
}
