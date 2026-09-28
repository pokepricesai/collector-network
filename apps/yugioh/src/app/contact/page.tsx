import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'How to reach YGOPrices for corrections, data-deletion requests, affiliate enquiries or general questions.',
  alternates: { canonical: 'https://ygoprices.io/contact' },
  robots: { index: true, follow: true },
};

export default function ContactPage() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 64px', lineHeight: 1.65 }}>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          <Link href="/">YGOPrices</Link> · Contact
        </p>
        <h1 style={{ fontSize: 30, marginTop: 8, marginBottom: 20 }}>Contact</h1>

        <section>
          <p>
            YGOPrices is a solo-run collector site. If you have a correction to a card, a
            printing or a price, please include the exact card URL (for example{' '}
            <Link href="/card/blue-eyes-white-dragon">/card/blue-eyes-white-dragon</Link>) so
            we can trace it back to the underlying record.
          </p>

          <h2>What to include</h2>
          <ul>
            <li>The card or set page URL you are looking at.</li>
            <li>What you expected to see and what you actually saw.</li>
            <li>Where the correct information comes from, if you can share a source.</li>
          </ul>

          <h2>Data and privacy requests</h2>
          <p>
            To delete your account and everything YGOPrices stores about you, sign in and use
            the Delete account button on <Link href="/settings">/settings</Link>. If you cannot
            sign in and need a data-deletion request handled manually, email us the account
            email address you registered with.
          </p>

          <h2>Reach us</h2>
          <p>
            Email: <a href="mailto:hello@ygoprices.io">hello@ygoprices.io</a>
          </p>
          <p style={{ color: 'var(--fg-muted)', fontSize: 13, marginTop: 24 }}>
            We are not staffed 24/7, but real emails get real replies from a human.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
