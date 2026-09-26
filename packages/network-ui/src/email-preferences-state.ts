// Tri-state preference reducer + interpretation helpers. Pure.
// Consumed by EmailPreferences.tsx and by unit tests.
//
// The tri-state is critical: a user with NO preference row must
// not be shown as "opted out". They are simply "no preference
// recorded" and must actively pick.

import type {
  MarketingPreference,
  SiteCode,
} from '@collector-network/auth';

export type TriState = 'no-preference' | 'opted-in' | 'opted-out';

// Interpret the current state for a given scope from the raw
// preference rows returned by getMarketingPreferences.
export function interpretSiteState(
  prefs: readonly MarketingPreference[],
  siteCode: SiteCode,
): TriState {
  const row = prefs.find(
    (p) => p.scope === 'site' && p.site_code === siteCode,
  );
  if (!row) return 'no-preference';
  return row.email_opt_in ? 'opted-in' : 'opted-out';
}

export function interpretNetworkState(
  prefs: readonly MarketingPreference[],
): TriState {
  const row = prefs.find((p) => p.scope === 'network');
  if (!row) return 'no-preference';
  return row.email_opt_in ? 'opted-in' : 'opted-out';
}

// Human-readable label for a TriState. Not brand-specific; used
// as helper text next to each toggle.
export function labelForState(state: TriState): string {
  switch (state) {
    case 'opted-in': return 'Subscribed';
    case 'opted-out': return 'Unsubscribed';
    case 'no-preference': return 'No preference recorded';
  }
}
