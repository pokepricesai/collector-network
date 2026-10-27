'use client';

// @collector-network/affiliate-tracking/whatnot
//
// CN-05 Sprint 5 — subtle, secondary Whatnot CTA. Whatnot's Impact
// programme stops earning commissions on 30 November 2026 23:59 UTC,
// so this component is deliberately self-expiring at the client:
//
//   * It is a 'use client' component. ISR-cached HTML will contain
//     an empty placeholder; the real anchor is only inserted on
//     hydration. After the cutoff, hydration returns null even for
//     pages whose SSR was cached before the cutoff.
//   * It respects NEXT_PUBLIC_WHATNOT_DISABLED=1 for immediate
//     per-site kill-switch (build-time).
//   * It also checks process.env at import time so a page rebuilt
//     after the env is set skips emitting the SSR placeholder too.
//
// This gives three independent cutoffs:
//   1. Build-time env (strongest; whole-site opt-out).
//   2. Hydration-time clock (ISR-safe; survives stale caches).
//   3. Hard-coded `CUTOFF` constant (fail-safe once past the date).

import { useEffect, useState } from 'react';

const WHATNOT_BASE = 'https://whatnot.pxf.io/bkJD0M';

/** 2026-11-30 23:59:59 UTC. Hard-coded so the link disappears
 *  everywhere even if someone forgets to flip the env var. */
export const WHATNOT_CUTOFF_MS = Date.UTC(2026, 10, 30, 23, 59, 59);

function buildIsDisabled(): boolean {
  // Build-time check. For client-side bundles, Next inlines
  // NEXT_PUBLIC_* at build; so a redeploy with the var set strips
  // the component down to null even in SSR output.
  return (process.env.NEXT_PUBLIC_WHATNOT_DISABLED ?? '').trim() === '1';
}

export interface WhatnotLinkProps {
  /** Site identifier for the SubID (e.g. 'pokeprices', 'ygo'). */
  site: string;
  /** Placement identifier for the SubID (e.g. 'footer'). */
  placement?: string;
  /** Visible CTA text. Keep it subtle. */
  children?: React.ReactNode;
}

export function WhatnotLink({
  site,
  placement = 'footer',
  children = 'Explore live auctions on Whatnot',
}: WhatnotLinkProps) {
  // Default to NOT visible on SSR / first paint. The useEffect flips
  // it to visible only if (a) env is not disabled AND (b) runtime
  // clock is before the cutoff. SSR output stays null, so cached
  // HTML cannot leak the link past the cutoff.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (buildIsDisabled()) return;
    if (Date.now() >= WHATNOT_CUTOFF_MS) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const subid = `${site}:${placement}`.slice(0, 70);
  const u = new URL(WHATNOT_BASE);
  u.searchParams.set('sharedid', subid);

  return (
    <a
      href={u.toString()}
      target="_blank"
      rel="sponsored nofollow noopener noreferrer"
      data-affiliate="1"
      data-component="WhatnotLink"
      data-placement={placement}
      data-page-type="footer"
      style={{
        fontSize: 12,
        color: 'inherit',
        opacity: 0.78,
        textDecoration: 'underline',
        textUnderlineOffset: 2,
      }}
    >
      {children}
    </a>
  );
}
