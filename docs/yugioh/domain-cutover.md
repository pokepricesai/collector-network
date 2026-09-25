# YGOPrices domain cutover checklist

The current production host is `yugioh-web.vercel.app`. When we
attach the final YGOPrices domain (e.g. `yugoh.example` / actual
domain TBD), work through this list. Nothing in the codebase
hard-codes `yugioh-web.vercel.app` in `apps/yugioh/src/**` - every
origin flows through `siteUrl()` / `NEXT_PUBLIC_SITE_URL`.

## Order of operations

1. **Add the domain in Vercel**
   `vercel domains add <domain>` → point the DNS records Vercel
   surfaces. Add the domain to the `yugioh-web` project as the
   Production alias. Verify the automatic Let's Encrypt cert
   issues (Vercel handles this).

2. **Update `NEXT_PUBLIC_SITE_URL`**
   ```
   vercel env rm  NEXT_PUBLIC_SITE_URL production
   vercel env add NEXT_PUBLIC_SITE_URL production --value "https://<domain>" --no-sensitive --force
   ```
   Redeploy so the new value bakes into `siteUrl()`. Impacts:
   - canonical URLs on every indexable page
   - Open Graph URLs
   - JSON-LD `url` on homepage + card pages
   - sitemap `<loc>` entries
   - deck sharing URL builders (public + unlisted)

3. **Update Supabase Auth Redirect URLs**
   In the shared Supabase project (preflightluke), add the new
   host to the Redirect URL allowlist:
   ```
   https://<domain>/**
   ```
   Keep `https://yugioh-web.vercel.app/**` in the allowlist too
   until traffic has fully drained (drop it a week after cutover).
   Do NOT change the shared Site URL - that would break other
   Collector Network sites.

4. **Update Google OAuth redirect URIs**
   In Google Cloud Console for the OAuth client used by the
   shared Supabase project, add:
   ```
   https://<supabase-project>.supabase.co/auth/v1/callback
   ```
   This URL is already there for the existing sites. YGOPrices
   itself does NOT register with Google; Google callbacks go to
   Supabase, and Supabase redirects back to our /auth/callback
   using the allowlist. So this step is usually a no-op - verify
   only.

5. **Sitemap hostname**
   Automatic. `siteUrl()` drives every `<loc>` in the sitemap
   index + shards. Fetch `/sitemap.xml` after the redeploy and
   confirm the hostname is the new one.

6. **Canonical hostname**
   Automatic. Every `alternates.canonical` and every JSON-LD
   URL uses `siteUrl()` / `absoluteUrl()`. Spot-check the
   homepage, one card page, one printing page, one public deck
   page after cutover.

7. **robots.txt**
   Automatic - `src/app/robots.ts` reads from `siteUrl()`.
   Confirm the new host's `/robots.txt` matches expectations.

8. **IndexNow (optional, post-launch)**
   Not currently implemented. Post-launch consideration - would
   let us proactively ping Bing/Yandex when public decks
   change. Not a launch blocker.

9. **Analytics**
   Vercel Web Analytics is domain-scoped by project, not host,
   so no reconfiguration needed. Custom events under
   `src/lib/analytics.ts` continue to fire.

10. **Ancillary Vercel bits**
    - Verify OG image endpoints (if any) resolve on the new host.
    - Verify `/api/prewarm` still works (uses `CRON_SECRET`).
    - Verify preview deployments are unaffected (they use
      `*.vercel.app` and preview env vars).

## Rollback

If the new domain has a problem, remove it as the production
alias in Vercel and keep `yugioh-web.vercel.app` primary. The
Supabase allowlist should still include the .vercel.app host per
step 3 during the transition window.

## Sanity commands post-cutover

```
curl -sSI https://<domain>/                       # → 200
curl -sS  https://<domain>/robots.txt             # host matches
curl -sS  https://<domain>/sitemap.xml            # <loc> uses new host
curl -sSI https://<domain>/set/lob                # → 200
curl -sSI https://<domain>/deck/<any-known-slug>  # → 200 or 404 (not 500)
```

The two-user RLS probes and the security-share probe are
DB-scoped, so the host change does not affect them.
