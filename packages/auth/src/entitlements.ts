// CN-IDENTITY-01 · network-wide entitlement helpers.
//
// Thin server-side wrappers on the collector_memberships +
// collector_discord_links schema. Called by every site's
// account page + any future gate on the stock-alert / eBay-deal
// surfaces.
//
// All checks are server-side only. UI hiding is never the
// authoritative gate — every protected server endpoint must
// re-check via collector_user_has_feature or getUserMembership.

import type { SupabaseClient, User } from '@supabase/supabase-js';

export type MembershipTier = 'free' | 'premium';
export type MembershipStatus = 'active' | 'cancelled' | 'expired' | 'suspended';

export type Feature =
  | 'stock_alerts_free'
  | 'stock_alerts_premium'
  | 'ebay_deals_free'
  | 'ebay_deals_premium';

export interface MembershipSummary {
  tier: MembershipTier;
  status: MembershipStatus;
  activated_at: string;
  expires_at: string | null;
  discord_linked: boolean;
}

export interface DiscordLink {
  discord_user_id: string;
  discord_username: string | null;
  discord_avatar: string | null;
  linked_at: string;
  disconnected_at: string | null;
}

/** Read the signed-in user's membership tier + Discord-link status.
 *  Uses the collector_user_membership_view which joins the two
 *  tables server-side. Returns null when no row exists (new
 *  signup race: the trigger should have created a row but we
 *  tolerate missing data rather than assume premium). */
export async function getUserMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<MembershipSummary | null> {
  const { data, error } = await supabase
    .from('collector_user_membership_view')
    .select('tier, status, activated_at, expires_at, discord_linked')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[@collector-network/auth] getUserMembership error:', error.message);
    return null;
  }
  if (!data) return null;
  return data as MembershipSummary;
}

/** Server-side feature gate. Calls the SQL function so the tier /
 *  status / expires_at logic lives in one place. Returns false for
 *  anonymous users, missing memberships, inactive status, or
 *  expired premium (which auto-degrades to free features only).
 *
 *  SECURITY: this must be used as the authoritative gate on every
 *  protected server endpoint. Never rely on UI hiding. */
export async function userHasFeature(
  supabase: SupabaseClient,
  userId: string | null,
  feature: Feature,
): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase.rpc('collector_user_has_feature', {
    p_user_id: userId,
    p_feature: feature,
  });
  if (error) {
    console.error('[@collector-network/auth] userHasFeature error:', error.message);
    return false;
  }
  return data === true;
}

/** Helper that combines getCurrentUser + feature check. Returns
 *  the user when the feature is permitted, or null otherwise. Use
 *  from server components / route handlers. */
export async function requireFeature(
  supabase: SupabaseClient,
  user: User | null,
  feature: Feature,
): Promise<User | null> {
  if (!user) return null;
  const ok = await userHasFeature(supabase, user.id, feature);
  return ok ? user : null;
}

/** Read the user's Discord link row from collector_discord_links.
 *  Used by the account page to render the Connect/Disconnect state. */
export async function getUserDiscordLink(
  supabase: SupabaseClient,
  userId: string,
): Promise<DiscordLink | null> {
  const { data, error } = await supabase
    .from('collector_discord_links')
    .select('discord_user_id, discord_username, discord_avatar, linked_at, disconnected_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    // PGRST116 = no row; expected for not-yet-linked users
    if (error.code !== 'PGRST116') {
      console.error('[@collector-network/auth] getUserDiscordLink error:', error.message);
    }
    return null;
  }
  if (!data) return null;
  const link = data as DiscordLink;
  // Hide a soft-disconnected link from consumers; the row persists
  // in the DB for audit but the UI should treat the user as unlinked.
  if (link.disconnected_at) return null;
  return link;
}

/** Called by /api/auth/discord-link/callback after the user returns
 *  from Supabase's linkIdentity OAuth flow. We extract the Discord
 *  identity from auth.identities, then upsert via the server-side
 *  RPC which uses auth.uid() to identify the row owner — the
 *  authenticated caller cannot overwrite another user's row.
 *
 *  Returns { ok: true, link } on success, or { ok: false, code: 'already_linked' }
 *  when the Discord identity already belongs to another CN user. */
export type LinkResult =
  | { ok: true; link: DiscordLink }
  | { ok: false; code: 'already_linked' | 'no_discord_identity' | 'db_error'; message: string };

export async function linkDiscordFromAuthIdentity(
  supabase: SupabaseClient,
  _userId: string,
): Promise<LinkResult> {
  // The _userId parameter is retained for API compatibility with
  // the callback route, but the server-side RPC now uses auth.uid()
  // from the Supabase JWT — a session-less or cross-user call will
  // be rejected with not_authenticated. See migration
  // 20261107080000_cn_identity_01_sec_fixes.sql.
  void _userId;

  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return { ok: false, code: 'db_error', message: userErr?.message ?? 'no auth user' };
  }
  const identities = (userResp.user.identities ?? []) as Array<{
    provider: string;
    provider_id?: string;
    identity_data?: { sub?: string; username?: string; name?: string; avatar_url?: string; email?: string };
  }>;
  const discord = identities.find((i) => i.provider === 'discord');
  if (!discord) {
    return { ok: false, code: 'no_discord_identity', message: 'auth.identities has no discord provider' };
  }
  const discordUserId = discord.provider_id ?? discord.identity_data?.sub;
  if (!discordUserId) {
    return { ok: false, code: 'no_discord_identity', message: 'discord identity missing provider_id / sub' };
  }

  const { data: rpcData, error: rpcErr } = await supabase.rpc('collector_link_discord', {
    p_discord_user_id: discordUserId,
    p_username:        discord.identity_data?.username ?? discord.identity_data?.name ?? null,
    p_avatar:          discord.identity_data?.avatar_url ?? null,
    p_email:           discord.identity_data?.email ?? null,
  });
  if (rpcErr) {
    if (/discord_already_linked/i.test(rpcErr.message)) {
      return { ok: false, code: 'already_linked', message: 'This Discord account is already linked to another Collector Network account.' };
    }
    return { ok: false, code: 'db_error', message: rpcErr.message };
  }
  return { ok: true, link: rpcData as DiscordLink };
}

/** Disconnect Discord: removes the Supabase Auth linked identity
 *  FIRST (so no Discord sign-in path remains attached to the user),
 *  then marks our collector_discord_links row disconnected for
 *  audit. Both steps must succeed — if the Supabase identity
 *  removal fails, we do NOT flip our table, so the UI remains
 *  honest about the state until the next attempt.
 *
 *  Idempotent: if no Discord identity is attached (already
 *  removed, never linked), still flips our row to disconnected
 *  and returns ok. */
export type UnlinkResult =
  | { ok: true }
  | { ok: false; code: 'not_authenticated' | 'identity_removal_failed' | 'db_error'; message: string };

export async function unlinkDiscord(
  supabase: SupabaseClient,
  _userId: string,
): Promise<UnlinkResult> {
  void _userId;

  // 1. Remove the Discord identity from Supabase first. If it never
  //    existed, that's a benign no-op; we still flip our row.
  try {
    const { data: idents, error: identErr } = await supabase.auth.getUserIdentities();
    if (identErr) {
      return { ok: false, code: 'identity_removal_failed', message: identErr.message };
    }
    const discord = (idents?.identities ?? []).find((i) => i.provider === 'discord');
    if (discord) {
      const { error: unlinkErr } = await supabase.auth.unlinkIdentity(discord);
      if (unlinkErr) {
        // The Supabase Auth identity is still attached. We must
        // not flip our table — that would misrepresent the state.
        return { ok: false, code: 'identity_removal_failed', message: unlinkErr.message };
      }
    }
  } catch (e) {
    return { ok: false, code: 'identity_removal_failed', message: (e as Error)?.message ?? String(e) };
  }

  // 2. Identity is gone (or was never there). Flip our row.
  const { error: rpcErr } = await supabase.rpc('collector_unlink_discord');
  if (rpcErr) {
    if (/not_authenticated/i.test(rpcErr.message)) {
      return { ok: false, code: 'not_authenticated', message: rpcErr.message };
    }
    return { ok: false, code: 'db_error', message: rpcErr.message };
  }
  return { ok: true };
}
