import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { EmailPreferencesMount } from '../settings/EmailPreferencesMount';
import styles from '../account/Account.module.css';

// Preference centre. Private, noindex, not in sitemap. Uses the
// same shared EmailPreferences component the /settings surface
// uses but with source='preference_center' so audit events are
// distinguishable in the immutable consent history.
export const metadata: Metadata = {
  title: 'Email preferences - YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function EmailPreferencesPage() {
  await requireUser('/email-preferences');
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <section className={styles.section}>
          <EmailPreferencesMount
            siteCode="ygo"
            source="preference_center"
            heading="Your email preferences"
            introText="Choose which emails you want to receive from across the Collector Network. Changes save immediately. Your account keeps working even if you unsubscribe from every marketing email."
          />
        </section>
        <section className={styles.section}>
          <p className={styles.sectionCaption}>
            You can also manage these choices in{' '}
            <Link href="/settings" style={{ color: 'var(--ygo-accent-gold-strong)' }}>
              Settings
            </Link>
            .
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
