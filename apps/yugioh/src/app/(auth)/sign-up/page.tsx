import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { AuthForm } from '../AuthForm';
import styles from '../Auth.module.css';

export const metadata: Metadata = {
  title: 'Create account — YGOPrices',
  robots: { index: false, follow: true },
};

export default function SignUpPage() {
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <Suspense>
          <AuthForm mode="sign-up" />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
