import Link from 'next/link';
import { getCurrentUser } from '@collector-network/auth';

// Auth chip rendered inside the Navbar. Server component so we can
// read the session cookie on every request.
//
// Signed-out state:  Sign in (secondary link) + Create account (primary CTA).
// Signed-in state:   User chip → /account.

export async function AccountChip() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Link
          href="/sign-in"
          className="nav-link"
          style={{
            padding: '7px 12px',
            borderRadius: 10,
            color: 'var(--text)',
            textDecoration: 'none',
            fontSize: 13.5,
            fontWeight: 600,
          }}
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          style={{
            padding: '8px 14px',
            borderRadius: 10,
            background: 'var(--primary, #6A43BE)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: 13.5,
            fontWeight: 700,
            border: '1px solid transparent',
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
        padding: '5px 12px 5px 5px',
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
          background: 'var(--accent-2)',
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
