import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'How YGOPrices handles your account data, session cookies, analytics, affiliate clicks and Supabase-backed storage.',
  alternates: { canonical: 'https://ygoprices.io/privacy' },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 64px', lineHeight: 1.65 }}>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          <Link href="/">YGOPrices</Link> · Privacy
        </p>
        <h1 style={{ fontSize: 30, marginTop: 8, marginBottom: 20 }}>Privacy</h1>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13, marginBottom: 24 }}>
          Effective: 2026-09-28. This is a plain-English summary of the data YGOPrices collects
          and how it is used. If anything here conflicts with the site actually running, this
          document wins.
        </p>

        <section>
          <h2>What YGOPrices stores about you</h2>
          <p>
            Browsing YGOPrices without signing in is anonymous. We do not build a profile of
            unauthenticated visitors and we do not use third-party ad networks.
          </p>
          <p>
            When you sign in, we store a small profile row (display name, avatar preference,
            preferred currency), the collection you record on{' '}
            <Link href="/collection">/collection</Link>, cards you save on{' '}
            <Link href="/watchlist">/watchlist</Link>, and decks you build on{' '}
            <Link href="/decks">/decks</Link>. These rows are stored in our Supabase project and
            protected by Row Level Security so only your account can read or edit them.
          </p>

          <h2>Cookies and sessions</h2>
          <p>
            YGOPrices uses first-party cookies to keep you signed in and to remember the theme
            you picked. We do not use third-party advertising cookies. Session cookies are
            marked HttpOnly and SameSite so a link from another site can never impersonate you.
          </p>

          <h2>Analytics</h2>
          <p>
            We run anonymous page-view counts through Vercel Web Analytics. If Google Analytics
            is enabled for YGOPrices it is set to IP anonymisation and used only for
            aggregate site statistics.
          </p>

          <h2>Affiliate links</h2>
          <p>
            The Find on eBay buttons across YGOPrices are eBay Partner Network affiliate
            links. If you buy through one we may earn a commission at no cost to you. eBay is
            the party you transact with; we do not see your purchase details.
          </p>

          <h2>Emails</h2>
          <p>
            The only email YGOPrices sends today is the magic-link sign-in email issued by
            Supabase Auth. We do not run a marketing mailing list.
          </p>

          <h2>Deleting your account</h2>
          <p>
            You can delete your account from <Link href="/settings">/settings</Link>. The
            deletion wipes your collection, watchlist, decks and profile from our database. The
            underlying Supabase auth user identity is retained if the account is shared with
            another Collector Network site.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about this policy or a data-deletion request? Reach us through{' '}
            <Link href="/contact">/contact</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
