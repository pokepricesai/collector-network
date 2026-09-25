// Thin, safe wrapper around @vercel/analytics `track`. Central place
// to keep event names + property shapes consistent so we can rename
// or swap providers without hunting through the app.
//
// Rules:
//   • Event names in kebab-case.
//   • Properties never carry user_id, email or any auth token.
//   • Any error thrown by the analytics SDK is swallowed - never let
//     a metrics call take down a user action.
//   • Called only from client components (`'use client'`).

import { track as vercelTrack } from '@vercel/analytics';

type Props = Record<string, string | number | boolean | null>;

export function track(event: string, props?: Props): void {
  try {
    vercelTrack(event, props ?? {});
  } catch {
    // Swallow - analytics must never break the app.
  }
}

// ── Event catalogue ─────────────────────────────────────────────
//
// Kept as helpers so the call sites can't drift from the agreed
// names. Extend here; do not invent event names inline.

export const analytics = {
  signup: () => track('signup'),
  addToCollection: (opts: { section?: string } = {}) =>
    track('add-to-collection', { section: opts.section ?? null }),
  addToWatchlist: () => track('add-to-watchlist'),
  removeFromWatchlist: () => track('remove-from-watchlist'),
  deckCreated: () => track('deck-created'),
  deckCardAdded: (opts: { section: string }) =>
    track('deck-card-added', { section: opts.section }),
  deckPublished: (opts: { visibility: 'unlisted' | 'public' }) =>
    track('deck-published', { visibility: opts.visibility }),
  deckDuplicated: () => track('deck-duplicated'),
  sharedDeckCopied: (opts: { source: 'public' | 'unlisted' }) =>
    track('shared-deck-copied', { source: opts.source }),
};
