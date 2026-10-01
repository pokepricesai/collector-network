import Link from 'next/link';
import PlatformGrid from '@/components/PlatformGrid';
import { ArrowRight } from '@/components/icons';
import { SITE_NAME } from '@/lib/sites';

export const revalidate = 86_400;

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <span className="eyebrow">Collector Network</span>
          <h1>
            Five specialist platforms<br />
            for trading card <span className="gradient">collectors</span>.
          </h1>
          <p className="hero-lede">
            {SITE_NAME} brings together dedicated pricing, market data and
            collection tools across five of the world&apos;s leading trading
            card games.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <Link href="/partner" className="btn btn-primary btn-lg">
              <span>Partner with us</span>
              <ArrowRight className="arrow" />
            </Link>
            <Link href="/#platforms" className="btn btn-ghost btn-lg">
              See the platforms
            </Link>
          </div>
        </div>
      </section>

      <section className="platforms-section">
        <div className="container">
          <div className="platforms-head">
            <div style={{ display: 'grid', gap: 10 }}>
              <span className="eyebrow">Our platforms</span>
              <h2>Each site, built for its own game.</h2>
            </div>
            <p>
              Specialist sites, shared infrastructure. Open any platform in a
              new tab.
            </p>
          </div>
          <PlatformGrid />
        </div>
      </section>

      <section className="section section-tinted">
        <div className="container cards-2">
          <div className="card">
            <span className="eyebrow">About</span>
            <h2 style={{ fontSize: 22, marginTop: 10, marginBottom: 10 }}>
              One network. Five specialist platforms.
            </h2>
            <p className="muted" style={{ fontSize: 15 }}>
              Each site is built specifically around its own trading card
              game, sharing technology, market-data expertise and collector-
              focused tools.
            </p>
            <div style={{ marginTop: 20 }}>
              <Link href="/about" className="btn btn-ghost">
                <span>About {SITE_NAME}</span>
                <ArrowRight className="arrow" />
              </Link>
            </div>
          </div>
          <div className="card">
            <span className="eyebrow">Partner</span>
            <h2 style={{ fontSize: 22, marginTop: 10, marginBottom: 10 }}>
              Work with {SITE_NAME}.
            </h2>
            <p className="muted" style={{ fontSize: 15 }}>
              Reach collectors across several specialist platforms rather
              than buying generic display advertising. Marketplace, grading,
              retail, data and sponsorship opportunities.
            </p>
            <div style={{ marginTop: 20 }}>
              <Link href="/partner" className="btn btn-primary">
                <span>Partner with us</span>
                <ArrowRight className="arrow" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
