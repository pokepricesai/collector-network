'use client';

// Client-side affiliate-click beacon. Rendered once in a root
// layout. Attaches a capturing click listener on <body> that
// intercepts clicks on any <a data-affiliate="1"> and fires a
// one-way sendBeacon to /api/affiliate/event. Navigation is NEVER
// blocked, awaited, or affected by the beacon result.
//
// Why capture-phase: the EbayFindButton may be nested inside other
// listeners; we need to see the click before user-code can
// stopPropagation.

import { useEffect } from 'react';

export interface AffiliateTrackingProps {
  /** API path for the ingest route in this app. Defaults to '/api/affiliate/event'. */
  endpoint?: string;
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
        const payload = {
          event_type: 'click',
          placement,
          page_type: link.getAttribute('data-page-type') ?? undefined,
          source_component: link.getAttribute('data-component') ?? undefined,
          card_slug: link.getAttribute('data-card-slug') ?? undefined,
          set_slug: link.getAttribute('data-set-slug') ?? undefined,
          intent: link.getAttribute('data-intent') ?? undefined,
          marketplace: (() => {
            // Try to extract eBay marketplace from the href host.
            try {
              const u = new URL(link.href);
              if (u.host === 'www.ebay.co.uk') return 'GB';
              if (u.host === 'www.ebay.com') return 'US';
              if (u.host === 'www.ebay.de') return 'DE';
              if (u.host === 'www.ebay.fr') return 'FR';
              if (u.host === 'www.ebay.it') return 'IT';
              if (u.host === 'www.ebay.es') return 'ES';
              if (u.host === 'www.ebay.com.au') return 'AU';
              if (u.host === 'www.ebay.ca') return 'CA';
            } catch { /* ignore */ }
            return undefined;
          })(),
        };

        const body = JSON.stringify(payload);
        if ('sendBeacon' in navigator) {
          const blob = new Blob([body], { type: 'application/json' });
          navigator.sendBeacon(endpoint, blob);
        } else {
          // Fallback: fire-and-forget fetch with keepalive. Deliberately
          // not awaited.
          void fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } });
        }
      } catch { /* fail-open — never block navigation */ }
    };
    document.addEventListener('click', handler, { capture: true, passive: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, [endpoint]);
  return null;
}
