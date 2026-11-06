# CN-IDENTITY-01 · network-wide memberships + Discord linking

**Status:** engineering complete. Awaiting two operator actions: apply the migration + enable the Discord OAuth provider in the Supabase dashboard.

## 1. Existing shared-auth architecture (confirmed, untouched)

The Collector Network already runs **one** Supabase project (`egidpsrkqvymvioidatc`) with:

- `auth.users` as the canonical identity across all 5 sites (`pokemon`, `mtg`, `ygo`, `onepiece`, `lorcana`)
- Shared `@collector-network/auth` package: `createServerSupabase`, `createBrowserSupabase`, `getCurrentUser`, `requireUser`, `readMiddlewareSession`
- Shared `AuthForm` on every site with Google OAuth + email/password (identical across yugioh/onepiece/lorcana)
- CN-A tables: `collector_sites`, `collector_user_sites`, `collector_marketing_preferences`, `collector_marketing_consent_events`, `collector_signup_context`
- `/auth/callback/route.ts` per site: `exchangeCodeForSession` + three idempotent membership RPCs
- Site-scoped protected routes (`/account`, `/collection`, `/settings`, `/watchlist`, `/dashboard`) via `requireUser()` + per-site middleware that refreshes session cookies

**No changes** to any of the above in this PR.

## 2. Supported login methods (unchanged)

- **Google OAuth** — currently working on all 5 sites
- **Email / password** — currently working on all 5 sites
- **Discord sign-in** — deliberately NOT added to the login page (would risk silent duplicate accounts). Discord is available only as a connect-from-logged-in action on the Account page.
- **Email magic-link** — considered and deferred. Supabase's built-in magic-link works today without new code, but routing it through our Resend templates needs Supabase SMTP configuration (an operator task). Documented as a future add; not urgent while Google works.

## 3. Discord sign-in + secure account linking

**Discord account linking** is implemented end-to-end:

- `supabase.auth.linkIdentity({ provider: 'discord' })` attaches Discord to the existing authenticated user — no new Supabase user is created, same `user_id` preserved.
- OAuth callback at `/api/auth/discord-link/callback` finalises the exchange and mirrors the Discord identity into our own `collector_discord_links` table via the `collector_link_discord` SECURITY DEFINER function.
- `UNIQUE (discord_user_id)` on the table + a typed exception (`discord_already_linked`) prevent a second Collector Network account from claiming the same Discord identity.
- `UNIQUE (user_id)` prevents the same CN account from having two Discord rows.
- Disconnect endpoint at `/api/auth/discord-link/disconnect` soft-disconnects (preserves audit trail) and best-effort unlinks the Supabase identity.
- Same user relinking a different Discord account updates the existing row in-place.

**Discord sign-in (standalone) is NOT enabled** in the login UI. Rationale: a fresh Discord OAuth (not via `linkIdentity`) would create a brand-new Supabase user disconnected from the user's existing Google-based account — exactly the silent-duplicate scenario the brief forbids. Discord-only sign-up can be added later via a dedicated flow that detects and refuses (or deliberately merges) existing accounts.

## 4. Email magic-link status

Not implemented in this milestone. Reasons:
- Google is already reliable
- Supabase's default magic-link emails come from an `authtoken.supabase.co` domain which looks unprofessional without a custom SMTP configuration
- Routing through Resend would require Supabase SMTP settings + template design — operator work that distracts from the Discord-linking critical path

Easy future add. Documented for CN-IDENTITY-02 if needed.

## 5. Account UI now working

**OnePiecePrices /account** gains a "Membership & connections" section between the profile summary and the quick-links footer, showing:

- The same account works across all 5 sites (explicit notice)
- Plan tile: Free / Premium + expiry if any + friendly alert-launch copy
- Discord tile: either "Connect Discord" button (Discord brand colour, uses `linkIdentity`) or linked-username + "Disconnect" form
- Inline flash messages for every error/success case: `connected`, `disconnected`, `already_linked`, `denied`, `link_failed`, `exchange_failed`, `no_session`, `no_discord_identity`, `disconnect_failed`, `invalid`

**Design choice:** OnePiece is the pattern site. Rolling the same `IdentityPanel.tsx` component (self-contained; takes props) into yugioh + lorcana is a copy-paste PR of ~10 lines per site that I'll ship next. The component depends only on `@collector-network/auth` which already exists on every site.

## 6. Network-wide entitlement implementation

**New table** `collector_memberships` — one row per `auth.users.id`, carrying:
- `tier ∈ {free, premium}` — single network-wide tier (no per-site rows)
- `status ∈ {active, cancelled, expired, suspended}` — operator-controlled
- `activated_at`, `expires_at` — timestamps
- `source ∈ {signup, operator, trial, gift, billing}` — audit of where the row came from

**Auto-provisioned** via AFTER INSERT trigger on `auth.users`: every new signup immediately gets a `free` row. Existing users are backfilled by the migration (no manual step).

**Server-side gate**: `collector_user_has_feature(user_id, feature)` SQL function. Four features:
- `stock_alerts_free`, `ebay_deals_free` — free tier
- `stock_alerts_premium`, `ebay_deals_premium` — premium only

Expired premium (expires_at < now) auto-degrades to free features. Inactive status revokes all features. Discord-linked alone never grants premium.

**TypeScript helpers** (`@collector-network/auth`):
- `getUserMembership(supabase, userId)` — reads the view, returns `MembershipSummary | null`
- `userHasFeature(supabase, userId, feature)` — calls the RPC, server-enforced
- `requireFeature(supabase, user, feature)` — helper wrapper for route handlers
- `getUserDiscordLink / linkDiscordFromAuthIdentity / unlinkDiscord` — Discord link management

**Operator upgrade** (manual, until billing lands) via Supabase SQL:
```sql
SELECT public.collector_set_membership_tier(
  '<user_id>'::uuid, 'premium',
  (now() + interval '1 month'), 'operator', 'pilot promotion');
```

## 7. Tests + deployment results

**18 new tests, all passing** (`apps/hub/src/server/__tests__/cn-identity-01.test.ts`):

- Schema is additive (both tables + UNIQUE constraints)
- AFTER INSERT trigger auto-provisions a `free` row for every new `auth.users` insert
- Feature-gate matrix: anonymous / free / premium / expired-premium / inactive-cancelled × 4 features
- Operator tier-set helper (upgrade bumps `activated_at`, downgrade zeroes `expires_at`, invalid tier rejected)
- Discord linking: first link succeeds, duplicate `discord_user_id` rejected with typed error, re-link by same user updates in place, unlink soft-disconnects without locking out the account, unlinked Discord ID stays blocked from another CN account (operator-moderated — documented so future relaxation is deliberate)
- Discord linking does NOT grant premium (orthogonality guaranteed)
- CN-STOCK-02 pilot isolation (migration SQL text grep — no `cn_stock_` references)

**Full stock + identity suite:** 53/53 passing.

**Hub + OnePiece typecheck:** clean.

**Deployment:** PR open against `main`. Safe to merge — no Supabase changes until operator applies the migration SQL manually.

## 8. Operator checklist (short, single-session)

**A. Apply the migration.** Open Supabase SQL editor and paste the entire file:
```
C:\Users\lukep\AppData\Local\Temp\cn-identity-01-migration\apply.sql
```
Idempotent. Verification queries are at the bottom of the file; expected: `memberships_total = auth_users` after the backfill runs.

**B. Enable the Discord OAuth provider in Supabase.**
1. https://discord.com/developers/applications → New Application → name `Collector Network` (or your preferred brand). Copy the **Application ID** (becomes your Discord client ID).
2. OAuth2 → General → **Reset Secret**, copy the client secret.
3. OAuth2 → Redirects → add exactly: `https://egidpsrkqvymvioidatc.supabase.co/auth/v1/callback`
4. Supabase dashboard → Authentication → Providers → Discord → **Enable**. Paste client ID + client secret. Save.
5. Supabase dashboard → Authentication → URL Configuration → add these to **Redirect URLs**:
   - `https://onepieceprices.io/api/auth/discord-link/callback`
   - `https://onepieceprices.io/account` (for post-link navigation; also the default redirect)
   - Add equivalents for the other 4 sites once we roll out the `IdentityPanel` there (listed in §10 below).

**No secret is ever pasted into chat or committed.** The Supabase project stores the Discord client secret; our code only invokes `supabase.auth.linkIdentity({ provider: 'discord' })`.

**C. Merge PR #12.**

**D. Verify** by signing into OnePiecePrices with an existing Google account, opening `/account`, and clicking "Connect Discord". Expected outcome: Discord OAuth consent → redirect to `/account?discord=connected` → tile shows the Discord username + Disconnect button.

If the migration is applied but the Discord provider is still disabled, clicking Connect Discord shows a friendly "Discord linking failed" flash — no crash, nothing destructive.

## 9. What remains before free-account holders can access gated Discord alert channels

The brief explicitly asks for this list. In order:

1. **Supabase Discord provider enabled** (operator step B above).
2. **Rollout `IdentityPanel` to yugioh + lorcana + pokeprices + mtgprices**. Each site gets:
   - Discord-link callback + disconnect routes (copy from OnePiece, swap return path)
   - `IdentityPanel` component (same file, swap brand colour if desired)
   - Account page insert (3-line change)
3. **Discord server + roles**. Separate operator-side setup:
   - Create `Free Alerts` role in the private test server used by CN-STOCK-02
   - Create `Premium Alerts` role
   - Create (or identify) the alert channels and set their visibility by role
4. **Discord bot for role sync**. Not in this PR — needs:
   - A Discord bot with `Manage Roles` permission
   - A Supabase Edge Function or Hub cron that reconciles role membership from `collector_memberships.tier` + `collector_discord_links` (every 15 min; idempotent)
   - Audit log for role grants/revocations
5. **Channel gating**. Once the bot runs, the Discord webhook in CN-STOCK-02's outbox can route to the appropriate channel based on the listener's tier (free alerts → `#free-alerts`, premium → `#premium-alerts`).

Between (1) and (3): a free account can LINK their Discord in-app, but nothing happens on the Discord server side because no bot is syncing roles yet. (4) is the gate that actually unlocks the member-only channels.

## 10. How this fits CN-STOCK and CN-DEALS without duplicating infrastructure

**CN-STOCK-02 pilot (currently running):** Unchanged. The outbox posts to `discord:test` (private channel). When CN-STOCK-03 (member-facing alerts) ships, the outbox gets additional `target` values like `discord:free-alerts` and `discord:premium-alerts`, and the probe queues the right target by checking `collector_user_has_feature(<subscriber>, 'stock_alerts_premium')` for each alert.

**Future CN-DEALS (undervalued eBay deals):** Same `userHasFeature` gate. One SQL function, two features (`ebay_deals_free`, `ebay_deals_premium`). No new auth code required — plugs straight into the shared `collector_memberships` table.

**No parallel subscription systems.** `collector_memberships` is the single source of truth for every future entitlement. When the billing layer (Stripe or otherwise) lands, it writes to this table via `collector_set_membership_tier` with `source = 'billing'`.

## 11. Updated master roadmap

- **Completed in this cycle:** CN-STOCK-01 (benchmark), CN-STOCK-02 (engine + pilot activation — 48h window running), CN-IDENTITY-01 (this PR).
- **CN-IDENTITY-02 (next):** Roll `IdentityPanel` to yugioh + lorcana + pokeprices + mtgprices. Small, repetitive. ~1 PR per site, half a day of work.
- **CN-DISCORD-01 (post-CN-STOCK-02 pilot):** Discord bot + role sync + per-role channel gating. Depends on Supabase Discord provider being enabled (operator step B).
- **CN-STOCK-03 (post-pilot):** Member-facing alerts. Expand watchlist, add free-vs-premium latency/delivery differences.
- **CN-DEALS-01 (parallel track):** Undervalued eBay deals feed, gated via the same `collector_user_has_feature` helper.
- **CN-BILLING-01 (future):** Stripe (or similar) → `collector_memberships.source = 'billing'` + expiry management.

Pilot-blocked (unchanged from the previous status):
- **CN-06.01-P13** MTG `refresh-set-value-daily` halt — data-freshness regression
- **CN-06.05 PSA pilot** — awaiting operator-side account permissions
- **CN-STOCK-02 pilot** — 48h clock running; return when the organic window closes
