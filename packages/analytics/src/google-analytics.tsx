// packages/analytics/src/google-analytics.tsx
// Shared GA4 component. Reads NEXT_PUBLIC_GA_ID at build time.
//
// Safe no-op when unset. When set, emits the standard gtag pair
// via Next.js's <Script> so it stays out of hydration critical path.
// No consent-banner integration yet — that's an editorial decision
// each site can layer on later.

import Script from 'next/script';

export interface GoogleAnalyticsProps {
  /** Overrides the env-driven ID. Preferred pattern: leave unset and
   *  let the component read NEXT_PUBLIC_GA_ID. */
  measurementId?: string;
}

/** GA4 script pair. Renders nothing if no id is configured. */
export function GoogleAnalytics(props: GoogleAnalyticsProps = {}) {
  const id = props.measurementId ?? process.env['NEXT_PUBLIC_GA_ID'] ?? '';
  if (!id.trim()) return null;
  const clean = id.trim();
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${clean}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${clean}', { send_page_view: true });
        `}
      </Script>
    </>
  );
}

/** True when GA is configured. Useful for conditional debug UI. */
export function isGoogleAnalyticsEnabled(): boolean {
  return Boolean((process.env['NEXT_PUBLIC_GA_ID'] ?? '').trim());
}
