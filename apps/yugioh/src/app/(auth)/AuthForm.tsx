'use client';

// Shared client form used by both /sign-in and /sign-up. Handles
// email/password submission + Google OAuth start. Errors show
// inline; success navigates to the caller-supplied return path.
//
// CN-B: signup form carries two optional opt-in checkboxes.
// Unchecked = OMITTED metadata key (never `false`) so the
// tri-state model at the DB layer stays honest.

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  applySignupMarketingConsent,
  buildSignupMetadata,
  createBrowserSupabase,
  recordOriginFromSignup,
  recordSiteAuthentication,
} from '@collector-network/auth';
import {
  NETWORK_CONSENT_COPY,
  SHARED_ACCOUNT_EXPLANATION,
  SITE_CONSENT_COPY,
} from '@collector-network/network-config';
import { safeReturnTo } from '../../lib/return-to';
import { analytics } from '../../lib/analytics';
import styles from './Auth.module.css';

// This site's Collector Network code, per collector_sites.code.
const YGO_SITE_CODE = 'ygo';
const ygoCopy = SITE_CONSENT_COPY.ygo;

// Fire an auxiliary Supabase RPC but never let its failure block
// the auth flow. Membership + consent writes are important but
// idempotent; the next auth event will retry.
async function bestEffort<T>(p: Promise<T>): Promise<void> {
  try {
    await p;
  } catch {
    // swallowed on purpose
  }
}

interface Props {
  mode: 'sign-in' | 'sign-up';
}

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [siteOpt, setSiteOpt] = useState(false);
  const [networkOpt, setNetworkOpt] = useState(false);
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
        // buildSignupMetadata omits any unchecked opt-in from
        // options.data — never sends `false`. The AFTER INSERT
        // trigger on auth.users snapshots what actually arrives.
        const metadata = buildSignupMetadata({
          originSite: YGO_SITE_CODE,
          siteMarketingOptIn: siteOpt ? true : undefined,
          networkMarketingOptIn: networkOpt ? true : undefined,
        });
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
            data: metadata,
          },
        });
        if (error) throw error;
        analytics.signup();
        if (data.user && !data.session) {
          setInfo(
            'Check your email to confirm your account. You can close this tab and click the link from your inbox.',
          );
        } else {
          // Rare path (email confirmation disabled): session live
          // immediately. Apply origin + consent + membership.
          await bestEffort(recordOriginFromSignup(supabase));
          await bestEffort(applySignupMarketingConsent(supabase));
          await bestEffort(recordSiteAuthentication(supabase, YGO_SITE_CODE));
          router.push(returnTo);
          router.refresh();
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // Password sign-in never visits /auth/callback. All three
        // RPCs are idempotent replay-safe.
        await bestEffort(recordOriginFromSignup(supabase));
        await bestEffort(applySignupMarketingConsent(supabase));
        await bestEffort(recordSiteAuthentication(supabase, YGO_SITE_CODE));
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
      // Google OAuth also carries signup metadata for first-time
      // users. The Supabase pattern for OAuth signup is to bake
      // options.data into the flow via the query state; simplest
      // Supabase OAuth options do not accept `data` the way signUp
      // does, and the auth.users AFTER INSERT trigger has already
      // fired by the time we could call updateUser({data:...}) to
      // populate metadata. Accept for CN-B first cut that OAuth
      // signups have empty snapshots: origin stays null, signup
      // consent is not captured. OAuth users can still opt in
      // later via /settings or /email-preferences.
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
          : SHARED_ACCOUNT_EXPLANATION}
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

      {/* method="post" defends against submits before JS hydrates:
          the browser POSTs same-URL (no route handler → 405) instead
          of the default GET, which would ship credentials in the
          address bar. onSubmit's preventDefault handles the normal
          hydrated case. */}
      <form onSubmit={onSubmit} method="post" className={styles.form}>
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

        {/* CN-B: two OPTIONAL opt-in checkboxes on signup only.
            Both unchecked by default. Leaving them unchecked
            omits the metadata key (never sends false) so the DB
            snapshot records "no preference" not "opted out". */}
        {mode === 'sign-up' && (
          <fieldset className={styles.consentGroup}>
            <legend className={styles.consentLegend}>Email preferences (optional)</legend>
            <label className={styles.consentRow}>
              <input
                type="checkbox"
                checked={siteOpt}
                onChange={(e) => setSiteOpt(e.target.checked)}
                className={styles.consentCheckbox}
              />
              <span>
                <span className={styles.consentLabel}>{ygoCopy.label}</span>
                <span className={styles.consentDesc}>{ygoCopy.description}</span>
              </span>
            </label>
            <label className={styles.consentRow}>
              <input
                type="checkbox"
                checked={networkOpt}
                onChange={(e) => setNetworkOpt(e.target.checked)}
                className={styles.consentCheckbox}
              />
              <span>
                <span className={styles.consentLabel}>{NETWORK_CONSENT_COPY.label}</span>
                <span className={styles.consentDesc}>{NETWORK_CONSENT_COPY.description}</span>
              </span>
            </label>
          </fieldset>
        )}

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
