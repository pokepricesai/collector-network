import Link from 'next/link';
import { getCurrentUser } from '@collector-network/auth';
import { getLorcanaCurrency } from '../lib/currency-server';
import { AccountMenu } from './AccountMenu';
import { CurrencyToggle } from './CurrencyToggle';

// Right-side navbar slot. Server component so we can read the auth
// session and the currency cookie on every request.
//
// Signed-out state:
//   [ CurrencyToggle ]  Sign in  Sign up
//
// Signed-in state:
//   [ CurrencyToggle ]  Dashboard  [avatar-dropdown]
//
// The dropdown holds Dashboard / Collection / Watchlist / Account /
// Settings / Sign out so the primary public nav stays uncluttered.

export async function AccountChip() {
  const [user, currency] = await Promise.all([
    getCurrentUser(),
    getLorcanaCurrency(),
  ]);
  if (!user) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <CurrencyToggle initial={currency} />
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
  const displayName =
    (user.user_metadata?.['full_name'] as string | undefined) ??
    (user.user_metadata?.['name'] as string | undefined) ??
    user.email ??
    'Account';
  const initial = String(displayName).trim().charAt(0).toUpperCase() || 'U';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <CurrencyToggle initial={currency} />
      <Link
        href="/dashboard"
        style={{
          padding: '7px 14px',
          borderRadius: 10,
          background: 'var(--primary, #6A43BE)',
          color: '#fff',
          textDecoration: 'none',
          fontSize: 13.5,
          fontWeight: 700,
          border: '1px solid transparent',
        }}
      >
        Dashboard
      </Link>
      <AccountMenu displayName={displayName} initial={initial} />
    </div>
  );
}
