// @collector-network/analytics — shared analytics primitives.
//
// Scope today: GA4 script pair keyed by NEXT_PUBLIC_GA_ID. Safe no-op
// when unset so preview / pre-launch environments never send hits.

export { GoogleAnalytics, isGoogleAnalyticsEnabled } from './google-analytics';
export type { GoogleAnalyticsProps } from './google-analytics';
