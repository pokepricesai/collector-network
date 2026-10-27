'use client';

// Client-side affiliate-click beacon. Rendered once in a root
// layout. Attaches a capturing click listener on <body> that
// intercepts clicks on any <a data-affiliate="1"> and (a) fires a
// GA4 `affiliate_click` event when gtag is available, and (b)
// optionally fires a one-way sendBeacon to the configured endpoint.
// Navigation is NEVER blocked, awaited, or affected by either call.
//
// Why capture-phase: the EbayFindButton may be nested inside other
// listeners; we need to see the click before user-code can
// stopPropagation.
//
// GA4 vs beacon split, by design (CN-05 Sprint 3):
//   * GA4 is the primary attribution channel — always-on when gtag
//     is defined, zero server cost, standard GA4 reporting surfaces.
//   * The server beacon is OPTIONAL — pass `endpoint: null` (or an
//     empty string) to disable it for sites that do not want a
//     per-click Supabase write. See docs/affiliate-tracking.md.

import { useEffect } from 'react';

export interface AffiliateTrackingProps {
  /**
   * API path for the ingest route in this app. Defaults to
   * '/api/affiliate/event'. Pass `null` to fire GA4 events only
   * with no server beacon.
   */
  endpoint?: string | null;
}

interface GtagWindow {
  gtag?: (command: 'event', eventName: string, params?: Record<string, unknown>) => void;
}

export function AffiliateTracking({ endpoint = '/api/affiliate/event' }: AffiliateTrackingProps = {}) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (ev: MouseEvent) => {
      try {
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        const link = target.closest<HTMLAnchorElement>('a[data-affiliate="1"]');
        if (!link) return;

        const placement =
          link.getAttribute('data-placement')
          ?? link.getAttribute('data-source')
          ?? 'affiliate_cta';

        let destinationHost: string | undefined;
        let marketplace: string | undefined;
        try {
          const u = new URL(link.href);
          destinationHost = u.host;
          // Known eBay marketplace mapping.
          if (u.host === 'www.ebay.co.uk') marketplace = 'GB';
          else if (u.host === 'www.ebay.com') marketplace = 'US';
          else if (u.host === 'www.ebay.de') marketplace = 'DE';
          else if (u.host === 'www.ebay.fr') marketplace = 'FR';
          else if (u.host === 'www.ebay.it') marketplace = 'IT';
          else if (u.host === 'www.ebay.es') marketplace = 'ES';
          else if (u.host === 'www.ebay.com.au') marketplace = 'AU';
          else if (u.host === 'www.ebay.ca') marketplace = 'CA';
        } catch { /* ignore */ }

        const payload = {
          event_type: 'click',
          placement,
          page_type: link.getAttribute('data-page-type') ?? undefined,
          source_component: link.getAttribute('data-component') ?? undefined,
          card_slug: link.getAttribute('data-card-slug') ?? undefined,
          set_slug: link.getAttribute('data-set-slug') ?? undefined,
          intent: link.getAttribute('data-intent') ?? undefined,
          marketplace,
        };

        // GA4 event — always-on when gtag is defined. Standard snake_case
        // parameter names. The `site` dimension is also recorded at the
        // GA4 property level, so it's redundant here but useful for
        // cross-property reporting where the same tag container is
        // shared.
        const w = window as unknown as GtagWindow;
        if (typeof w.gtag === 'function') {
          w.gtag('event', 'affiliate_click', {
            site: window.location.hostname,
            placement,
            page_type: payload.page_type,
            source_component: payload.source_component,
            card_slug: payload.card_slug,
            set_slug: payload.set_slug,
            intent: payload.intent,
            marketplace,
            destination_host: destinationHost,
          });
        }

        // Server beacon — optional. When endpoint is null/empty we
        // skip the sendBeacon entirely; GA4 is the only channel.
        if (endpoint && typeof endpoint === 'string' && endpoint.length > 0) {
          const body = JSON.stringify(payload);
          if ('sendBeacon' in navigator) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon(endpoint, blob);
          } else {
            void fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } });
          }
        }
      } catch { /* fail-open — never block navigation */ }
    };
    document.addEventListener('click', handler, { capture: true, passive: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, [endpoint]);
  return null;
}
