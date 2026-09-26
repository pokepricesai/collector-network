'use client';

// Shared client form for /sign-in and /sign-up. Handles email/password
// submission + Google OAuth start. Errors show inline; success
// navigates to the caller-supplied return path.
//
// CN-B: signup carries two optional opt-in checkboxes. Unchecked =
// OMITTED metadata key (never `false`) so the tri-state model at the
// DB layer stays honest.

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

const OP_SITE_CODE = 'onepiece';
const opCopy = SITE_CONSENT_COPY.onepiece;

// Fire an auxiliary Supabase RPC without letting its failure block
// auth. Membership + consent writes are important but idempotent;
// the next auth event retries.
async function bestEffort<T>(p: Promise<T>): Promise<void> {
  try {
    await p;
  } catch {
    /* swallowed on purpose */
  }
}

interface Props {
  mode: 'sign-in' | 'sign-up';
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: '28px 24px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  boxShadow: 'var(--shadow-md, 0 3px 12px rgba(20,33,61,0.06))',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-strong, var(--border))',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 14,
  boxSizing: 'border-box',
};

const submitStyle: React.CSSProperties = {
  padding: '11px 14px',
  borderRadius: 10,
  border: '1px solid var(--gold-600)',
  background: 'var(--gold-600)',
  color: '#111',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  marginTop: 4,
};

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
        const metadata = buildSignupMetadata({
          originSite: OP_SITE_CODE,
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
          await bestEffort(recordOriginFromSignup(supabase));
          await bestEffort(applySignupMarketingConsent(supabase));
          await bestEffort(recordSiteAuthentication(supabase, OP_SITE_CODE));
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
        await bestEffort(recordSiteAuthentication(supabase, OP_SITE_CODE));
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
    <div style={wrapStyle}>
      <h1 style={{ margin: 0, fontFamily: "Outfit, system-ui, sans-serif", fontSize: 24, letterSpacing: '-0.01em', color: 'var(--text-strong)' }}>
        {mode === 'sign-in' ? 'Sign in to OnePiecePrices' : 'Create your OnePiecePrices account'}
      </h1>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        {mode === 'sign-in'
          ? 'One OnePiecePrices account across collections and preferences. Browse without signing in whenever you want.'
          : SHARED_ACCOUNT_EXPLANATION}
      </p>

      <button
        type="button"
        onClick={onGoogle}
        disabled={pending}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'var(--text-strong)',
          color: '#fff',
          fontSize: 13.5,
          fontWeight: 600,
          border: 0,
          cursor: pending ? 'not-allowed' : 'pointer',
          opacity: pending ? 0.6 : 1,
        }}
      >
        <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden focusable="false">
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
          <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24z" />
          <path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4 0-.8.1-1.6.4-2.4V6.5H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.7l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
        </svg>
        <span>Continue with Google</span>
      </button>

      <div
        style={{
          position: 'relative',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          padding: '4px 0',
        }}
      >
        <span style={{ padding: '0 8px', background: 'var(--surface)', position: 'relative', zIndex: 1 }}>or</span>
      </div>

      {/* method="post" defends against submits before JS hydrates:
          the browser POSTs same-URL (no route handler → 405) instead
          of the default GET, which would ship credentials in the
          URL. onSubmit's preventDefault handles the hydrated case. */}
      <form onSubmit={onSubmit} method="post" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Password</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {mode === 'sign-up' && (
          <fieldset
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '10px 12px',
              background: 'var(--bg-light)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <legend style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 4px' }}>
              Email preferences (optional)
            </legend>
            <label style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'start', cursor: 'pointer', padding: '4px 0' }}>
              <input
                type="checkbox"
                checked={siteOpt}
                onChange={(e) => setSiteOpt(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--gold-600)', width: 16, height: 16 }}
              />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{opCopy.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2 }}>{opCopy.description}</span>
              </span>
            </label>
            <label style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'start', cursor: 'pointer', padding: '4px 0' }}>
              <input
                type="checkbox"
                checked={networkOpt}
                onChange={(e) => setNetworkOpt(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--gold-600)', width: 16, height: 16 }}
              />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{NETWORK_CONSENT_COPY.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2 }}>{NETWORK_CONSENT_COPY.description}</span>
              </span>
            </label>
          </fieldset>
        )}

        {error && (
          <p style={{ margin: 0, padding: '8px 10px', borderRadius: 8, background: 'rgba(177, 42, 47, 0.1)', border: '1px solid rgba(177, 42, 47, 0.35)', color: '#8a1c1f', fontSize: 12.5 }}>
            {error}
          </p>
        )}
        {info && (
          <p style={{ margin: 0, padding: '8px 10px', borderRadius: 8, background: 'rgba(232, 192, 105, 0.12)', border: '1px solid rgba(232, 192, 105, 0.35)', color: 'var(--gold-800, #8a6a1c)', fontSize: 12.5 }}>
            {info}
          </p>
        )}
        <button type="submit" style={{ ...submitStyle, opacity: pending ? 0.6 : 1, cursor: pending ? 'not-allowed' : 'pointer' }} disabled={pending}>
          {pending ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center' }}>
        {mode === 'sign-in' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <Link href={otherHref} style={{ color: 'var(--gold-600)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          {mode === 'sign-in' ? 'Create one' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}
