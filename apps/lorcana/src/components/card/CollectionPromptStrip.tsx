// Prominent Collection call-to-action shown on the logical card page.
// Server component — reads the session cookie once and switches shape:
//   * Signed out → "Sign in to add" + "Create free account" prompt.
//   * Signed in → soft prompt directing the user to the treatments
//     panel below, where they add the exact printing/finish.

import Link from 'next/link';
import { getCurrentUser } from '@collector-network/auth';

export interface CollectionPromptStripProps {
  cardName: string;
  returnPath: string;
}

export async function CollectionPromptStrip({ cardName, returnPath }: CollectionPromptStripProps) {
  const user = await getCurrentUser();
  const returnParam = encodeURIComponent(returnPath);

  if (!user) {
    return (
      <aside
        style={{
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'linear-gradient(180deg, rgba(106,67,190,0.06) 0%, rgba(106,67,190,0) 60%), var(--surface)',
          padding: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 260px', minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>
            Sign in to add {cardName} to your collection
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.55 }}>
            Track exact printings, foil vs nonfoil, raw or graded holdings
            with live value. Free forever.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link
            href={`/sign-in?returnTo=${returnParam}`}
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              border: '1px solid var(--border-strong, var(--border))',
              background: 'var(--surface)',
              color: 'var(--text-strong)',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Sign in
          </Link>
          <Link
            href={`/sign-up?returnTo=${returnParam}`}
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              background: 'var(--ink-amethyst, #6A43BE)',
              color: '#fff',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            Create free account
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside
      style={{
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        padding: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 13,
        color: 'var(--text-strong)',
      }}
    >
      <span style={{ fontWeight: 700 }}>Add {cardName} to your collection —</span>
      <span style={{ color: 'var(--text-muted)' }}>
        pick a treatment below (Common, Foil, Enchanted, …) to save the exact printing.
      </span>
    </aside>
  );
}
