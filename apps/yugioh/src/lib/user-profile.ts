// YGO user-profile + preferences shape. Stored in Supabase auth
// user_metadata under the `ygo` namespace so we don't need a
// separate schema for Slice C. When the shared-schema owner
// materialises `ygo_user_profiles` / `ygo_user_preferences`, only
// this file changes — every consumer keeps working.

import type { CollectorNetworkUser } from '@collector-network/auth';

export const AVATAR_KEYS = [
  'dragon',
  'spellcaster',
  'trap',
  'spell',
  'star',
  'eye',
  'card-stack',
] as const;
export type AvatarKey = (typeof AVATAR_KEYS)[number];

export const CURRENCIES = ['USD', 'EUR'] as const;
export type PreferredCurrency = (typeof CURRENCIES)[number];

export const PRICE_DISPLAY_MODES = ['raw-and-graded', 'raw-only', 'graded-only'] as const;
export type PriceDisplayMode = (typeof PRICE_DISPLAY_MODES)[number];

export const GRADERS = ['any', 'psa', 'bgs', 'cgc', 'sgc'] as const;
export type PreferredGrader = (typeof GRADERS)[number];

export interface YgoProfileFields {
  display_name?: string | null;
  avatar_key?: AvatarKey | null;
}

export interface YgoPreferenceFields {
  preferred_currency?: PreferredCurrency;
  price_display?: PriceDisplayMode;
  preferred_grader?: PreferredGrader;
}

// Merged shape a page reads for a signed-in user.
export interface YgoProfile {
  displayName: string;
  avatarKey: AvatarKey;
  preferredCurrency: PreferredCurrency;
  priceDisplay: PriceDisplayMode;
  preferredGrader: PreferredGrader;
}

const DEFAULTS: YgoProfile = {
  displayName: '',
  avatarKey: 'dragon',
  preferredCurrency: 'USD',
  priceDisplay: 'raw-and-graded',
  preferredGrader: 'any',
};

// Pull the YGO namespace out of user_metadata and merge with defaults.
export function readYgoProfile(user: CollectorNetworkUser): YgoProfile {
  const md = user.user_metadata ?? {};
  const ygo = (md['ygo'] as Record<string, unknown> | undefined) ?? {};
  const identity = ygo['profile'] as YgoProfileFields | undefined;
  const prefs = ygo['preferences'] as YgoPreferenceFields | undefined;
  const displayName =
    (typeof identity?.display_name === 'string' && identity.display_name.trim()) ||
    // Fallback chain: metadata display_name (Google gives this) →
    // email local-part → empty.
    (typeof md['full_name'] === 'string' ? (md['full_name'] as string) : '') ||
    (typeof md['name'] === 'string' ? (md['name'] as string) : '') ||
    ((user.email ?? '').split('@')[0] ?? '');
  const avatarKey = isAvatarKey(identity?.avatar_key)
    ? identity.avatar_key
    : DEFAULTS.avatarKey;
  const preferredCurrency = isCurrency(prefs?.preferred_currency)
    ? prefs.preferred_currency
    : DEFAULTS.preferredCurrency;
  const priceDisplay = isPriceDisplay(prefs?.price_display)
    ? prefs.price_display
    : DEFAULTS.priceDisplay;
  const preferredGrader = isGrader(prefs?.preferred_grader)
    ? prefs.preferred_grader
    : DEFAULTS.preferredGrader;
  return { displayName, avatarKey, preferredCurrency, priceDisplay, preferredGrader };
}

// Pure validators — reused by the server action that writes updates.
export function isAvatarKey(v: unknown): v is AvatarKey {
  return typeof v === 'string' && (AVATAR_KEYS as readonly string[]).includes(v);
}
export function isCurrency(v: unknown): v is PreferredCurrency {
  return typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v);
}
export function isPriceDisplay(v: unknown): v is PriceDisplayMode {
  return (
    typeof v === 'string' && (PRICE_DISPLAY_MODES as readonly string[]).includes(v)
  );
}
export function isGrader(v: unknown): v is PreferredGrader {
  return typeof v === 'string' && (GRADERS as readonly string[]).includes(v);
}

// Cap display-name length so a pathological input can't blow the
// user_metadata blob (Supabase auth caps user_metadata at ~200KB).
export function sanitiseDisplayName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Called by the settings form. Only writes fields that were
// actually provided — leaves untouched fields alone so
// updating preferences doesn't clobber the display name.
export function buildProfilePatch(input: Partial<YgoProfile>): Record<string, unknown> {
  const profile: YgoProfileFields = {};
  const preferences: YgoPreferenceFields = {};
  if (input.displayName != null) profile.display_name = sanitiseDisplayName(input.displayName);
  if (input.avatarKey != null && isAvatarKey(input.avatarKey))
    profile.avatar_key = input.avatarKey;
  if (input.preferredCurrency != null && isCurrency(input.preferredCurrency))
    preferences.preferred_currency = input.preferredCurrency;
  if (input.priceDisplay != null && isPriceDisplay(input.priceDisplay))
    preferences.price_display = input.priceDisplay;
  if (input.preferredGrader != null && isGrader(input.preferredGrader))
    preferences.preferred_grader = input.preferredGrader;
  return { ygo: { profile, preferences } };
}
