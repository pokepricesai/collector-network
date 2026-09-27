import Link from 'next/link';
import { getCurrentUser } from '@collector-network/auth';

// Auth chip rendered inside the Navbar. Server component so we can
// read the session cookie on every request. Signed-out state = a
// simple "Sign in" link; signed-in state = a chip that links to
// /account (avatar UI stays minimal until we build a mini-dropdown).

export async function AccountChip() {
  const user = await getCurrentUser();
  if (!user) {
    // Signed-out: show both Sign in + Sign up so the primary
    // acquisition CTA is always visible in the header.
    return (
      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <Link
          href="/sign-in"
          style={{
            padding: '7px 12px',
            borderRadius: 10,
            background: 'transparent',
            border: '1px solid var(--border-strong, var(--border))',
            color: 'var(--text)',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          style={{
            padding: '7px 12px',
            borderRadius: 10,
            background: 'var(--gold-600)',
            color: '#111',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '0.02em',
          }}
        >
          Sign up
        </Link>
      </div>
    );
  }
  const initial =
    (user.email ?? user.user_metadata?.['full_name'] ?? 'U')
      .toString()
      .charAt(0)
      .toUpperCase() || 'U';
  return (
    <Link
      href="/account"
      aria-label="Your account"
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px 5px 5px',
        borderRadius: 999,
        background: 'var(--surface)',
        border: '1px solid var(--border-strong, var(--border))',
        color: 'var(--text)',
        textDecoration: 'none',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: 'var(--gold-600)',
          color: '#111',
          fontFamily: 'Outfit, system-ui, sans-serif',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {initial}
      </span>
      <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Account
      </span>
    </Link>
  );
}
