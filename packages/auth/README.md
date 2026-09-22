# @collector-network/auth

**Status:** shell only. No implementation.

## Responsibility (future)

- Shared authentication primitives (session, current-user, sign-in helpers).
- Consistent server-side user resolution across all network sites.
- A single canonical account model per network user, if we adopt one.

## Boundary

Provides auth primitives. Does not own UI, product-specific gating logic, or
per-site collection features. Sites layer their own auth-gated features on
top.

## Non-goals

- No hard-coded provider secrets.
- No decision yet on provider (Supabase Auth, Clerk, custom, etc.) — this
  package intentionally does not lock that in.
