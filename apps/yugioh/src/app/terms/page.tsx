import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';

export const metadata: Metadata = {
  title: 'Terms of use',
  description:
    'The terms of use for YGOPrices: acceptable use, affiliate disclosure, trademark disclaimer, no financial advice.',
  alternates: { canonical: 'https://ygoprices.io/terms' },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 64px', lineHeight: 1.65 }}>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          <Link href="/">YGOPrices</Link> · Terms of use
        </p>
        <h1 style={{ fontSize: 30, marginTop: 8, marginBottom: 20 }}>Terms of use</h1>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13, marginBottom: 24 }}>
          Effective: 2026-09-28.
        </p>

        <section>
          <h2>What YGOPrices is</h2>
          <p>
            YGOPrices is a collector reference site for Yu-Gi-Oh! trading cards. We catalogue
            cards, printings, rarities, editions, prices and graded values. We are not
            affiliated with, endorsed by or sponsored by Konami Digital Entertainment.
            Yu-Gi-Oh! is a registered trademark of Konami. Card names, artwork and metadata
            remain the property of their respective owners.
          </p>

          <h2>Not financial advice</h2>
          <p>
            Prices and rankings on YGOPrices are provided for reference only. They are not a
            recommendation to buy, sell or hold any card. Card markets can move in either
            direction and past values are no guarantee of future results.
          </p>

          <h2>Acceptable use</h2>
          <p>
            You may browse and search YGOPrices freely. If you sign in you may keep a personal
            collection, watchlist and set of decks. Please do not use the site to scrape data
            beyond normal browsing, publish content that is unlawful or infringes the rights
            of others, or attempt to gain access to accounts other than your own.
          </p>

          <h2>User content</h2>
          <p>
            Collections, watchlists and decks you save on YGOPrices belong to you. Public
            decks you deliberately share are readable by anyone with the URL. Everything else
            is private to your account and protected by Row Level Security. See{' '}
            <Link href="/privacy">/privacy</Link>.
          </p>

          <h2>Affiliate links</h2>
          <p>
            Find on eBay buttons on card and set pages are eBay Partner Network affiliate
            links. If you purchase through one YGOPrices may earn a commission at no cost to
            you. Your transaction is with eBay, not with YGOPrices.
          </p>

          <h2>Availability</h2>
          <p>
            YGOPrices is provided as-is. We do our best to keep prices and legality data fresh
            but we do not guarantee uninterrupted availability, complete accuracy or that any
            particular card, printing or price will be present on any given day.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about these terms can be sent through <Link href="/contact">/contact</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
