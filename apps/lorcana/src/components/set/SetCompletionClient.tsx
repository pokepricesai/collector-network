'use client';

// Client-side set-completion panel. Replaces the former server
// component so /set/[slug] can be ISR-cached without baking
// per-user ownership into the HTML.
//
// Mirror of the P1a AccountChip / ExactActionsClient pattern:
//   - initial render is a neutral loading shell (no shift)
//   - useEffect resolves session via createBrowserSupabase and
//     fetches /api/set/[slug]/completion in one shot
//   - signed-out: renders the sign-in CTA
//   - signed-in with no ownership rows: hides itself (same as the
//     old server component)
//   - signed-in with rows: renders the "X / Y, Z% complete" bar

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';

interface Props {
  setCode: string;
  setName: string;
}

interface CompletionData {
  owned: number;
  total: number;
  missingSample: unknown[];
}

type State =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'empty' }
  | { status: 'ready'; completion: CompletionData };

const PANEL_STYLE: React.CSSProperties = {
  padding: '14px 16px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  marginBottom: 20,
  display: 'grid',
  gap: 10,
};

export function SetCompletionClient({ setCode, setName }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    async function resolve() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session?.user) {
          setState({ status: 'signed-out' });
          return;
        }
        const r = await fetch(
          `/api/set/${encodeURIComponent(setCode.toLowerCase())}/completion`,
          { credentials: 'same-origin' },
        );
        if (!r.ok) {
          if (!cancelled) setState({ status: 'empty' });
          return;
        }
        const data = (await r.json()) as {
          ok: boolean;
          signedIn: boolean;
          completion: CompletionData | null;
        };
        if (cancelled) return;
        if (!data.signedIn) {
          setState({ status: 'signed-out' });
          return;
        }
        if (!data.completion || data.completion.total === 0) {
          setState({ status: 'empty' });
          return;
        }
        setState({ status: 'ready', completion: data.completion });
      } catch {
        if (!cancelled) setState({ status: 'empty' });
      }
    }
    void resolve();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void resolve();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [setCode]);

  if (state.status === 'loading') {
    // Neutral width-stable shell so the layout does not shift when
    // the real panel renders. ~70px matches the signed-in panel's
    // approximate height.
    return (
      <div
        style={{
          ...PANEL_STYLE,
          minHeight: 70,
        }}
        aria-hidden
      />
    );
  }

  if (state.status === 'empty') return null;

  if (state.status === 'signed-out') {
    return (
      <div style={PANEL_STYLE}>
        <div className="label-mono">Your collection</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Sign in to track your collection on this set.
          </span>
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(`/set/${setCode.toLowerCase()}`)}`}
            className="btn btn-sm btn-primary"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const { owned, total, missingSample } = state.completion;
  const pct = Math.round((owned / Math.max(total, 1)) * 100);
  const missingCount = total - owned;
  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div className="label-mono">Your collection · {setName}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {missingCount > 0 ? `${missingCount} missing` : 'Complete'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 22, fontWeight: 800, color: 'var(--text-strong)' }}>
          {owned.toLocaleString()} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>/ {total.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{pct}% complete</div>
      </div>
      <div
        aria-hidden
        style={{
          height: 8,
          borderRadius: 999,
          background: 'var(--surface-inset, rgba(0,0,0,0.06))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--accent-2, #6A43BE)',
            transition: 'width 200ms ease',
          }}
        />
      </div>
      {missingCount > 0 && missingSample.length > 0 && (
        <div style={{ fontSize: 12 }}>
          <Link
            href={`/collection?set=${encodeURIComponent(setCode.toLowerCase())}&missing=1`}
            style={{ color: 'var(--accent-2, #6A43BE)', textDecoration: 'none', fontWeight: 600 }}
          >
            See missing ({missingCount})
          </Link>
        </div>
      )}
    </div>
  );
}
