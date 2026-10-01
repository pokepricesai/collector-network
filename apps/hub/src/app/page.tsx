import Link from 'next/link';
import PlatformGrid from '@/components/PlatformGrid';
import { SITE_NAME } from '@/lib/sites';

export const revalidate = 86_400;

export default function HomePage() {
  return (
    <>
      <section className="section">
        <div className="container" style={{ display: 'grid', gap: 20, maxWidth: 760 }}>
          <h1>Five specialist platforms for trading card collectors.</h1>
          <p className="lede">
            {SITE_NAME} brings together dedicated pricing, market data and
            collection tools across five of the world&apos;s leading trading
            card games.
          </p>
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <PlatformGrid />
        </div>
      </section>

      <section className="section">
        <div className="container cards-2">
          <div className="card">
            <h2 style={{ fontSize: 20, marginBottom: 10 }}>One network. Five specialist platforms.</h2>
            <p className="muted" style={{ fontSize: 15 }}>
              Each site is built specifically around its own trading card game,
              sharing technology, market-data expertise and collector-focused
              tools. Specialist sites, shared infrastructure.
            </p>
            <div style={{ marginTop: 18 }}>
              <Link href="/about" className="btn btn-ghost">About {SITE_NAME}</Link>
            </div>
          </div>
          <div className="card">
            <h2 style={{ fontSize: 20, marginBottom: 10 }}>Work with {SITE_NAME}.</h2>
            <p className="muted" style={{ fontSize: 15 }}>
              Reach collectors across several specialist platforms rather than
              buying generic display advertising. Marketplace, grading, retail,
              data and sponsorship opportunities across the network.
            </p>
            <div style={{ marginTop: 18 }}>
              <Link href="/partner" className="btn btn-primary">Partner with us</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
