import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ygoprices-logo.png"
            alt="YGOPrices"
            className={styles.brandLogo}
            width={2172}
            height={724}
            loading="lazy"
            decoding="async"
          />
          <p className={styles.text}>
            A collector-first Yu-Gi-Oh! catalogue. Focused on exact
            printings, editions, rarities, and both raw and graded market
            values. Part of the Collector Network family of specialist
            trading-card sites.
          </p>
        </div>
        <div>
          <p className={styles.title}>Data + independence</p>
          <p className={styles.text}>
            <strong>Unofficial.</strong> Not affiliated with, endorsed by,
            or sponsored by Konami Digital Entertainment. Yu-Gi-Oh! is a
            registered trademark of Konami. Card names, artwork and
            rules are the property of their respective owners.
          </p>
          <p className={styles.text}>
            Raw market prices are sourced from{' '}
            <a
              className={styles.link}
              href="https://www.tcgplayer.com/"
              rel="noopener noreferrer"
              target="_blank"
            >
              TCGplayer
            </a>{' '}
            and{' '}
            <a
              className={styles.link}
              href="https://www.cardmarket.com/"
              rel="noopener noreferrer"
              target="_blank"
            >
              Cardmarket
            </a>{' '}
            via TCGGraph. Graded sales-value observations are aggregated
            from public grader and marketplace data. Currency is never
            converted; USD and EUR are shown as-is.
          </p>
          <p className={styles.text}>
            Find on eBay buttons across card and set pages are eBay
            Partner Network affiliate links. YGOPrices may earn a
            commission on qualifying purchases at no cost to you.
          </p>
          <p className={styles.text}>
            <a href="/privacy" className={styles.link}>Privacy</a>{' · '}
            <a href="/terms" className={styles.link}>Terms</a>{' · '}
            <a href="/contact" className={styles.link}>Contact</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
