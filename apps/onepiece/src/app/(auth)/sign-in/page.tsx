import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '../AuthForm';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return (
    <main style={{ maxWidth: 440, margin: '48px auto', padding: '0 24px 64px' }}>
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </main>
  );
}
