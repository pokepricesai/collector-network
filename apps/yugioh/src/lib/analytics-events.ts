// Yu-Gi-Oh! analytics event vocabulary. Constants only — no provider
// integration. Slice 9 owns the wiring to a real analytics backend.
// UI components import { trackEvent } and pass one of these keys; the
// current no-op implementation just makes future wiring a one-line
// change.

export const ANALYTICS_EVENTS = {
  SEARCH_SUBMITTED: 'search_submitted',
  SEARCH_SUGGESTION_SELECTED: 'search_suggestion_selected',
  HOMEPAGE_CARD_OPENED: 'homepage_card_opened',
  HOMEPAGE_SET_OPENED: 'homepage_set_opened',
  HOMEPAGE_GRADED_OPENED: 'homepage_graded_opened',
  RARITY_SELECTED: 'rarity_selected',
} as const;

export type AnalyticsEvent =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

// No-op tracker. Slice 9 replaces the body — do not add provider SDKs
// here. Never throw; analytics must never break user flows.
export function trackEvent(
  event: AnalyticsEvent,
  payload?: Record<string, unknown>,
): void {
  // Intentionally empty. Analytics provider is wired in Slice 9.
  void event;
  void payload;
}
