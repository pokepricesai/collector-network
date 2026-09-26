import type { Metadata } from 'next';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { ResetPasswordForm } from './ResetPasswordForm';
import styles from '../Account.module.css';

export const metadata: Metadata = {
  title: 'Reset your password - YGOPrices',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

// Reached by the recovery email flow: the /auth/confirm route
// runs verifyOtp with type=recovery, which establishes a
// recovery session. This page uses that session to accept a new
// password via updateUser. Requires a live session; if the link
// expired or the user cleared cookies, requireUser bounces to
// /sign-in.

export default async function ResetPasswordPage() {
  await requireUser('/account/reset-password');
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <h1 className={styles.name}>Reset your password</h1>
            <p className={styles.metaLine}>
              You are signed in from your recovery link. Choose a new password below.
            </p>
          </div>
        </header>
        <ResetPasswordForm />
      </main>
      <Footer />
    </>
  );
}
