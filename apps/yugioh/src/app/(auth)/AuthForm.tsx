'use client';

// Shared client form used by both /sign-in and /sign-up. Handles
// email/password submission + Google OAuth start. Errors show
// inline; success navigates to the caller-supplied return path.

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabase } from '@collector-network/auth';
import { safeReturnTo } from '../../lib/return-to';
import styles from './Auth.module.css';

interface Props {
  mode: 'sign-in' | 'sign-up';
}

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const returnTo = safeReturnTo(params.get('returnTo'));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      if (mode === 'sign-up') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Email link → /auth/callback picks up the session and
            // forwards to returnTo.
            emailRedirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
          },
        });
        if (error) throw error;
        if (data.user && !data.session) {
          setInfo(
            'Check your email to confirm your account. You can close this tab and click the link from your inbox.',
          );
        } else {
          router.push(returnTo);
          router.refresh();
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push(returnTo);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function onGoogle() {
    setError(null);
    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  const otherHref =
    mode === 'sign-in'
      ? `/sign-up${params.toString() ? `?${params}` : ''}`
      : `/sign-in${params.toString() ? `?${params}` : ''}`;

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>
        {mode === 'sign-in' ? 'Sign in to YGOPrices' : 'Create your YGOPrices account'}
      </h1>
      <p className={styles.subtitle}>
        {mode === 'sign-in'
          ? 'One YGOPrices account across collections, watchlists and decks. Browse without signing in whenever you want.'
          : 'One YGOPrices account across collections, watchlists and decks. Free — no card required.'}
      </p>

      <button
        type="button"
        className={styles.google}
        onClick={onGoogle}
        disabled={pending}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false">
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4 0-.8.1-1.6.4-2.4V6.5H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z"
          />
          <path
            fill="#EA4335"
            d="M12 4.8c1.7 0 3.3.6 4.5 1.7l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
          />
        </svg>
        <span>Continue with Google</span>
      </button>

      <div className={styles.divider}>
        <span>or</span>
      </div>

      <form onSubmit={onSubmit} className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Password</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
          />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        {info && <p className={styles.info}>{info}</p>}
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className={styles.altAction}>
        {mode === 'sign-in' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <Link href={otherHref} className={styles.altLink}>
          {mode === 'sign-in' ? 'Create one' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}
