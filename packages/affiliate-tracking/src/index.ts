// @collector-network/affiliate-tracking
//
// Thin shared instrumentation layer for logging affiliate clicks
// into public.network_affiliate_clicks (Collector Network OS Phase 5).
//
// Consumers:
//   * ./server    — route-handler factory for /api/affiliate/event
//   * ./client    — <AffiliateTracking /> React component (beacon)
//   * ./whatnot   — <WhatnotLink /> self-expiring subtle CTA

export { handleAffiliateEvent } from './server';
export type { AffiliateIngestOptions } from './server';
export { AffiliateTracking, classifyAffiliateMerchant } from './client';
export type { AffiliateTrackingProps } from './client';
export { WhatnotLink, WHATNOT_CUTOFF_MS } from './whatnot';
export type { WhatnotLinkProps } from './whatnot';
