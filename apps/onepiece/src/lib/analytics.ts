// Thin wrapper around @vercel/analytics track. One place for event
// names so we don't drift.
//
// Rules:
//   • Kebab-case event names.
//   • Never carry user_id / email / auth tokens in properties.
//   • Errors are swallowed. Never break a user action for a metric.
//   • Called only from client components.

import { track as vercelTrack } from '@vercel/analytics';

type Props = Record<string, string | number | boolean | null>;

export function track(event: string, props?: Props): void {
  try {
    vercelTrack(event, props ?? {});
  } catch {
    /* analytics must never break the app */
  }
}

export const analytics = {
  signup: () => track('signup'),
  addToCollection: (opts: { section?: string } = {}) =>
    track('add-to-collection', { section: opts.section ?? null }),
};
