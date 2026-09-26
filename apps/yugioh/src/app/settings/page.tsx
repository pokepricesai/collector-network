import type { Metadata } from 'next';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { readYgoProfile } from '../../lib/user-profile';
import styles from '../account/Account.module.css';
import { ChangeEmailForm } from './ChangeEmailForm';
import { DangerZone } from './DangerZone';
import { EmailPreferencesMount } from './EmailPreferencesMount';
import { SettingsForm } from './SettingsForm';

export const metadata: Metadata = {
  title: 'Settings - YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser('/settings');
  const profile = readYgoProfile(user);

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <section className={styles.section}>
          <h1 className={styles.sectionTitle}>Profile & preferences</h1>
          <p className={styles.sectionCaption}>
            Your display name and avatar appear on public decks you choose to
            share. Preferences apply site-wide but never override the raw /
            graded / currency labels on individual price rows.
          </p>
          <SettingsForm initial={profile} />
        </section>

        <section className={styles.section}>
          <EmailPreferencesMount siteCode="ygo" source="settings" />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          <ChangeEmailForm currentEmail={user.email ?? null} />
          <form
            method="post"
            action="/auth/sign-out"
            style={{ marginTop: 'var(--ygo-size-base)' }}
          >
            <button type="submit" className={styles.submit}>
              Sign out
            </button>
          </form>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Danger zone</h2>
          <DangerZone />
        </section>
      </main>
      <Footer />
    </>
  );
}
