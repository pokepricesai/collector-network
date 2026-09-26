# CN-C final smoke-test checklist

Status: **CLOSED — all rows PASS, 2026-09-26.**

Live verification complete. Signup (row 1), password recovery
(row 2), and Secure Email Change (row 3) all confirmed
end-to-end by preflightluke. Rows 4-6 (Resend delivery
dashboard, Edge Function clean 204, final-URL no-token) were
verified in the course of the row 1-3 tests. CN-C is closed in
the tracked docs — see `cn-c-manual-setup.md`.

Each test row records:
- **What to do** in the browser / inbox / dashboard.
- **What to look for** — the pass criterion.
- **Where to look** — the dashboard tab, header, or URL bar.

## 1. Signup confirmation — **PASS** (2026-09-26)

Verified end-to-end by preflightluke: new signup on
https://ygoprices.io → email received from Resend with the
YGOPrices display name → clicking the CTA lands on
`/account` with a live session.

## 2. Password recovery — **PASS** (2026-09-26)

Verified end-to-end by preflightluke: `resetPasswordForEmail`
triggered from https://ygoprices.io, email received with the
YGOPrices display name, CTA landed on `/account/reset-password`
with a live recovery session, new password set + confirmed,
final URL landed on `/account` with the token params stripped
and the new password worked on the next sign-in.

**Do:**
1. On https://ygoprices.io/sign-in, use the "Forgot password"
   flow (or trigger `supabase.auth.resetPasswordForEmail` from
   the browser console if the UI has not shipped it yet).
2. Open the resulting email in the recovery inbox.
3. Click the CTA.

**Expect:**
- Email subject: **Reset your YGOPrices password**.
- CTA URL: `https://ygoprices.io/auth/confirm?token_hash=<>&type=recovery&next=%2Faccount%2Freset-password`.
- Click lands on `https://ygoprices.io/account/reset-password`
  with a live session (page shows "You are signed in from your
  recovery link").
- Setting a new password + confirm redirects to
  `/account` and the user is signed in with the new password.
- Address bar on `/account/reset-password` contains NO
  `token_hash` / `type` / `next` query params.

**Fail flag if:**
- Email routes to `/auth/v1/verify?...` or shows a
  `No API key found` message.
- Password update returns a Supabase error the user cannot
  recover from.

## 3. Secure email change — **PASS** (2026-09-26)

Verified end-to-end by preflightluke via the newly-added
Change email section on YGO /settings. Current inbox received
`Confirm your YGOPrices email change` with `token_hash_new`;
new inbox received `Confirm your new YGOPrices email` with
`token_hash`. Both confirmation clicks completed the change.
Session persisted across the swap; new email became the
account email only after both confirmations landed.

**Do:**
1. Sign in as a real YGOPrices account.
2. Trigger an email change (in `/settings` if wired, or
   `supabase.auth.updateUser({ email: 'new@example.com' })`
   from the browser console).
3. Open BOTH the current inbox and the new inbox.

**Expect:**
- Current inbox receives an email whose subject reads
  **Confirm your YGOPrices email change** with a CTA URL that
  carries `token_hash=<token_hash_new>` and `type=email_change`.
- New inbox receives an email whose subject reads
  **Confirm your new YGOPrices email** with a CTA URL that
  carries `token_hash=<token_hash>` and `type=email_change`.
- Clicking BOTH links (current first, then new) completes the
  change. Auth session persists across the change.
- Neither final URL contains `token_hash` after redirect.

**Fail flag if:**
- Either inbox receives the WRONG email (e.g. new inbox gets the
  "confirm change" copy).
- Either link fails with `No API key found` or a GoTrue error.
- Session is lost after the swap.

## 4. Resend dashboard — successful delivery — **PASS** (2026-09-26)

Verified during the row 1-3 tests: Resend → Emails showed
each send as Delivered with the correct `category=auth`,
`brand=ygo`, `action=<signup|recovery|email_change>` tags and
populated Idempotency-Key column (`<uuid>:default` for single-
email actions, `<uuid>:to_current` / `<uuid>:to_new` for the
Secure Email Change pair).

**Do:**
- Open Resend → **Emails** for each of the tests above.

**Expect (for every test):**
- Status: **Delivered** (green).
- Tags: `category=auth`, `brand=ygo`, `action=<signup|recovery|email_change>`.
- Idempotency-Key column shows `<uuid>:default` for single-email
  actions, `<uuid>:to_current` and `<uuid>:to_new` for the two
  Secure Email Change messages.
- No 4xx / 5xx errors in the last 100 rows.

## 5. Edge Function — clean 204 on success — **PASS** (2026-09-26)

Verified during the row 1-3 tests: `auth-email` logs showed
`{"status":204,"sent":[...]}` on every success path with no
`TypeError: Response with null body status cannot have body`
stack in surrounding logs. Confirms the null-body fix from
commit `bd1ba56` is holding in production.

**Do:**
- Open Supabase → **Edge Functions** → `auth-email` → **Logs**.
- Look at the log lines from the smoke-test attempts above.

**Expect (for every success):**
- Log line JSON: `{"status":204,"sent":[{"brand":"ygo","action":"<signup|recovery|email_change>","variant":"<default|to_current|to_new>","toDomain":"<recipient-domain>"}]}`
- No `TypeError: Response with null body status cannot have body`
  stack in the surrounding logs.
- No 5xx from downstream Resend (would appear as
  `errorTag:"resend-<status>"`).

## 6. Final browser URL — no token_hash — **PASS** (2026-09-26)

Verified during the row 1-3 tests: after every successful
confirmation click, the address bar showed a clean same-origin
path (`/account`, `/account/reset-password`, or a `returnTo`
target) with no `token_hash`, `type`, or `next` query params.
The confirm route strips them by building a fresh URL from
the sanitised `next` before redirecting.

**Do:**
- After each successful confirmation click, look at the address
  bar.

**Expect:**
- URL is one of: `/account`, `/account/reset-password`,
  `/watchlist`, or another safe relative path from the AuthForm
  `returnTo`.
- No `token_hash=`, `type=`, or `next=` query params in the
  final URL. The route handler strips them by building a fresh
  URL from the sanitised `next` before redirecting.

## Closing CN-C

When every row above is PENDING → PASS (or explicitly marked as
"skip — not yet applicable" with a reason), the closure work is:

1. Update `docs/network/cn-c-manual-setup.md` status header:
   `PENDING MANUAL STEPS` → `APPLIED — CN-C closed`.
2. Add a "Result" section to that doc noting the closure date and
   which sites are covered (`ygo` at close; `mtg` / `pokemon` /
   `onepiece` / `lorcana` add on their own launch schedules).
3. Update this smoke-test doc's status header to
   `CLOSED — see closure timestamp below` with each row's
   result.
4. Update MEMORY / CN-D plan to note CN-C is closed.
