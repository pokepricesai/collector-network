import Link from 'next/link';
import { getCurrentUser } from '@collector-network/auth';

// Auth chip rendered inside the Navbar. Server component so we can
// read the session cookie on every request. Signed-out state = a
// simple "Sign in" link; signed-in state = a chip that links to
// /account (avatar UI stays minimal until we build a mini-dropdown).

export async function AccountChip() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Link
        href="/sign-in"
        className="nav-link"
        style={{
          flexShrink: 0,
          padding: '7px 14px',
          borderRadius: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border-strong, var(--border))',
          color: 'var(--text)',
          textDecoration: 'none',
          fontSize: 13.5,
          fontWeight: 600,
        }}
      >
        Sign in
      </Link>
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
