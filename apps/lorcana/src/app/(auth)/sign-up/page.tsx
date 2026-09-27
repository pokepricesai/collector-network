import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '../AuthForm';

export const metadata: Metadata = {
  title: 'Create account',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  return (
    <main style={{ maxWidth: 440, margin: '48px auto', padding: '0 24px 64px' }}>
      <Suspense>
        <AuthForm mode="sign-up" />
      </Suspense>
    </main>
  );
}
