'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

// Email + password sign-in only. There is no public admin signup;
// the account must already be present and active in
// public.network_admin_users. We call `supabase.auth
// .signInWithPassword` client-side so the SSR cookies land in the
// browser, then push to the returnTo path. The next request to a
// protected admin page re-runs requireAdmin() server-side.

function createBrowser() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!;
  return createBrowserClient(url, key);
}

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const sb = createBrowser();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        setError('Email or password incorrect.');
        setPending(false);
        return;
      }
      // Session cookies are now set. The next admin render will
      // re-check network_admin_users server-side.
      router.push(returnTo);
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setPending(false);
    }
  }

  return (
    <form className="admin-auth-form" onSubmit={onSubmit}>
      <div>
        <label htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </div>
      <div>
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </div>
      {error && <div className="admin-auth-error">{error}</div>}
      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
