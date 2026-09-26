# CN-C manual setup: Resend auth-email hook

Status: **PENDING MANUAL STEPS**. The code + tests are in place but
the live Supabase Send Email Hook is deliberately **not enabled**
until every step below has been completed by preflightluke in the
Resend and Supabase dashboards.

The CN-C spec explicitly requires: *"Do NOT enable the live
Supabase Send Email Hook yet unless the required real secrets and
verified sender already exist."* This doc is that checklist.

## Architecture recap

```
Supabase Auth
    │  Send Email Hook (Standard Webhooks POST)
    ▼
supabase/functions/auth-email          (shared edge function)
    │  HTTPS POST https://api.resend.com/emails
    │  header: Authorization: Bearer <RESEND_API_KEY>
    │  header: Idempotency-Key: <webhook-id>:<variant>
    ▼
Resend transactional API
    ▼
Recipient inbox
```

One Supabase project (`egidpsrkqvymvioidatc`), one shared edge
function, one Resend account, one verified sender email — five
different brand display names selected at send-time from the
`redirect_to` hostname.

## 1. Resend: verify the sender domain

We send from a single mailbox on a Collector Network subdomain
(e.g. `accounts@send.collector.network`). The per-brand display
name is prepended at send time as `Brand <shared-address>`; the
underlying address is shared.

1. In Resend → **Domains** → **Add Domain**. Add the sending
   domain (e.g. `send.collector.network`).
2. Resend generates the exact DNS records it needs. Add each row
   Resend supplies to the domain's DNS in the registrar / DNS
   host, unchanged. Typically this includes:
   - **SPF** (TXT) — the exact value Resend produces.
   - **DKIM** (TXT) — one or more TXT rows Resend generates for
     the `resend._domainkey` (or similar) selector.
   - **DMARC** (TXT) — Resend may recommend a starter policy.
   Do not invent values; copy Resend's dashboard verbatim.
3. Save the DNS changes and wait for Resend to report the domain
   as **verified**. **Do not skip DKIM** — Supabase Auth mail is
   transactional but bulk-adjacent and unsigned mail lands in
   spam.
4. Pick the exact `From:` address (e.g.
   `accounts@send.collector.network`). This is the value passed
   verbatim to Supabase as `AUTH_EMAIL_FROM_ADDRESS` in step 3.
   The address is on the domain you verified in this step, so no
   separate per-address verification is needed.

Result: one green "verified" domain in Resend, backed by green
DKIM record(s). Record the exact `From:` address; you will pass
it verbatim as a Supabase secret in step 3.

## 2. Resend: generate a transactional API key

1. In Resend → **API Keys** → **Create API Key**.
2. Name it `collector-network-auth-email-prod` (or similar). Scope
   it to sending only (not domain administration) if the UI offers
   granular permissions.
3. Copy the key **once**. Resend will not show it again. Resend
   API keys are prefixed with `re_`.
4. Store it in a password manager, not in a repo, chat log, or
   dotfile.

## 3. Supabase: set the three edge-function secrets

Use the Supabase CLI (recommended) so the values never appear in
shell history the way they would with the dashboard's copy-paste
UI. Log in as preflightluke first (`supabase login`).

```powershell
# From the repo root, once per secret.
supabase secrets set RESEND_API_KEY="re_********"
supabase secrets set AUTH_EMAIL_FROM_ADDRESS="accounts@send.collector.network"
supabase secrets set SEND_EMAIL_HOOK_SECRET="v1,whsec_********"
```

- `RESEND_API_KEY` — the key from step 2.
- `AUTH_EMAIL_FROM_ADDRESS` — the exact verified address from
  step 1. Must be a single address, not a display name. The edge
  function prepends the per-brand display name.
- `SEND_EMAIL_HOOK_SECRET` — the hook secret Supabase will show
  you in step 5. Set this **after** step 5 with the value Supabase
  generates. Leave as a placeholder until then.

Verify with `supabase secrets list` (values are masked). None of
these three values should ever be committed to git or embedded in
a browser bundle — the edge function reads them from `Deno.env`.

## 4. Deploy the edge function

```powershell
supabase functions deploy auth-email --no-verify-jwt
```

The `--no-verify-jwt` flag is required: Supabase's own Send Email
Hook does not sign the request with a Supabase JWT — it signs with
the Standard Webhooks HMAC secret from step 5. We verify that
signature ourselves inside the function.

Confirm the deploy in Supabase → **Edge Functions** → the function
`auth-email` should show a green health indicator. Its logs tab is
where the `console.log({ status, sent, errorTag })` lines will
appear once it starts receiving hooks.

## 5. Supabase: configure the Send Email Hook

In Supabase → **Authentication** → **Hooks** → **Send Email Hook**.

1. **Enable** the hook.
2. **Hook URL:**
   `https://egidpsrkqvymvioidatc.supabase.co/functions/v1/auth-email`
3. **Secret:** click **Generate secret**. Supabase produces a
   secret in the form `v1,whsec_<base64>`. Copy it once.
4. Immediately run the `supabase secrets set SEND_EMAIL_HOOK_SECRET`
   command from step 3 with the value you just copied.
5. Redeploy the edge function once more so it picks up the new
   secret (`supabase functions deploy auth-email --no-verify-jwt`).
6. **Save** the hook config in the dashboard.

At this point Supabase Auth will route every signup / recovery /
magiclink / email_change / invite / reauthentication email through
the edge function. **Verify with a test signup before proceeding.**

## 6. Supabase: allow the brand redirect URLs

The edge function chooses the brand from the `redirect_to`
hostname and refuses to redirect to unlisted hostnames. Supabase
Auth has its own allowlist (**Authentication** → **URL
Configuration** → **Redirect URLs**). Add the callback URLs for
every brand that should be able to send auth email:

- `https://ygoprices.io/auth/callback`
- `https://www.ygoprices.io/auth/callback`
- `https://mtgprices.io/auth/callback` (when the site is deployed)
- `https://www.mtgprices.io/auth/callback`
- `https://pokeprices.io/auth/callback` (when the site is deployed)
- `https://www.pokeprices.io/auth/callback`
- Any Vercel preview URLs you want to accept auth callbacks on
  during pre-launch (not required for CN-C to function).

If a brand's hostname is absent from Supabase's allowlist, Supabase
will reject the auth request before it ever reaches the hook. If a
hostname is present in Supabase but absent from the CN-C brand
registry (`supabase/functions/_shared/brand-registry.ts`), the hook
falls back to the neutral Collector Network template — this is the
intended behaviour for onepiece / lorcana pre-launch.

## 7. Smoke test

Do a single real signup on `ygoprices.io` (or trigger a password
recovery for a real inbox you control). Expected:

- Email arrives from `AUTH_EMAIL_FROM_ADDRESS` with the visible
  display name **YGOPrices** (i.e. `YGOPrices <accounts@...>`).
- Subject: **Confirm your YGOPrices account** (signup) or **Reset
  your YGOPrices password** (recovery).
- Button + fallback link both route through
  `https://egidpsrkqvymvioidatc.supabase.co/auth/v1/verify?...` and
  land on `https://ygoprices.io/auth/callback`.
- DKIM check passes (Gmail: three-dot menu → **Show original** →
  DKIM: `PASS`).
- No em dashes anywhere in the rendered mail.
- No newsletter / promotional content in the body.
- The Supabase edge-function log line shows `status: 204` and a
  `sent` array with `brand: 'ygo'`. No tokens, hashes, or API keys
  appear in the log.
- Resend dashboard → **Emails** shows the sent message tagged with
  `category=auth`, `brand=ygo`, `action=signup`. The Idempotency-Key
  column shows a value of the form `<uuid>:default`.

If any of these fail, disable the hook again from the Supabase
dashboard and fix the underlying issue before re-enabling — do
not paper over failures with a resend.

## 8. Rotation and revocation

- **Resend API key:** rotate at least yearly, or immediately if
  the key is ever seen in a screenshot, chat, or repo. Generate a
  new key in Resend, `supabase secrets set RESEND_API_KEY=...`,
  redeploy the function, then revoke the old key in Resend.
- **Hook secret:** rotate immediately if the secret leaks.
  Standard Webhooks supports space-separated multi-secret rotation
  during rollover; the verifier already accepts either. Sequence:
  generate new secret in Supabase, temporarily set
  `SEND_EMAIL_HOOK_SECRET` to `<new> <old>` (space-separated),
  redeploy, wait one deploy cycle, then drop the old value.
- **Verified sender:** if the sending domain is compromised or
  needs to move, verify the new domain in Resend first, deploy the
  updated `AUTH_EMAIL_FROM_ADDRESS`, then remove the old domain in
  Resend. Reversing the order will bounce every auth email in
  flight.

## 9. What CN-C intentionally does NOT do

- No Resend **audiences** or **contacts** are touched. Recipients
  are not enrolled in marketing.
- No **newsletter** copy in transactional templates.
- No **unsubscribe** link (transactional auth email is not subject
  to unsubscribe — that is a CN-D concern for marketing).
- No **audience segmentation**.
- No **Resend webhooks** wired up yet. Bounce / complaint /
  delivery events are not consumed by CN-C. If we later want
  provider-side delivery signals, that is a separate slice.
- No client-side Resend SDK — all Resend calls originate from the
  server-side edge function.

Newsletter / marketing subscriptions and their consent lifecycle
are CN-D. Do not start CN-D until CN-C has been running cleanly in
production for at least a week.

## 10. Rollback

If any of the above steps fails or an incident occurs:

1. Supabase → **Authentication** → **Hooks** → **Send Email Hook** →
   **Disable**. Supabase falls back to its built-in mailer
   immediately.
2. Investigate. Restore only when the smoke test in step 7 passes
   again.

## Reference: files touched by CN-C

- `supabase/functions/auth-email/index.ts` — Deno entry.
- `supabase/functions/auth-email/deno.json` — Deno config.
- `supabase/functions/_shared/brand-registry.ts` — hostname →
  brand.
- `supabase/functions/_shared/verify-webhook.ts` — Standard
  Webhooks HMAC verification.
- `supabase/functions/_shared/render-email.ts` — HTML + text
  renderer.
- `supabase/functions/_shared/resend-transport.ts` — Resend API
  wrapper.
- `supabase/functions/_shared/handle-request.ts` — request
  dispatch (signature, brand, planSends, send).
- `supabase/functions/_shared/*.test.ts` — 62 unit tests, run
  with `pnpm --filter @collector-network/yugioh run test:auth-email`.
- `supabase/config.toml` — `[functions.auth-email] verify_jwt = false`.
