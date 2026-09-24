import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { AuthForm } from '../AuthForm';
import styles from '../Auth.module.css';

export const metadata: Metadata = {
  title: 'Sign in — YGOPrices',
  robots: { index: false, follow: true },
};

export default function SignInPage() {
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <Suspense>
          <AuthForm mode="sign-in" />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
