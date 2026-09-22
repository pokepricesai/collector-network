# Build order

This is the current planned sequence. Each item is an explicit slice that
ships before the next begins. Do not skip ahead.

1. **Monorepo foundation.** *(this slice)*
   Workspace, tooling, shared package shells, initialised Yu-Gi-Oh app with
   only a placeholder homepage. No product work yet.
2. **Yu-Gi-Oh research / product specification.**
   Competitive audit, target audience, differentiators, terminology
   decisions, IA sketch, editorial voice. Written specs, no code.
3. **Shared database / read layer.**
   Implement `@collector-network/database` (Supabase client + generated
   types) and `@collector-network/market-data` (read helpers on top of
   `tcg_market_prices_*` and `tcg_graded_prices_*`). Wired only against
   development/staging credentials.
4. **Yu-Gi-Oh visual / product system.**
   Yu-Gi-Oh-specific branding, typography, component vocabulary. Not shared
   with other games. Establishes the site's identity.
5. **Yu-Gi-Oh homepage / search.**
   First real user-facing surfaces powered by real data.
6. **Yu-Gi-Oh card pages.**
   Deep card detail, printings, prices, movers — designed for Yu-Gi-Oh
   collectors specifically.
7. **Yu-Gi-Oh set / archetype pages.**
   Set browsing and archetype exploration, using Yu-Gi-Oh-native concepts.
8. **Auth / collection integration.**
   Sign-in, collection tracking, wishlisting. `@collector-network/auth`
   implemented against a chosen provider.
9. **Affiliate / analytics / SEO.**
   Fill out `@collector-network/affiliate`, `@collector-network/analytics`
   and `@collector-network/seo` with what the Yu-Gi-Oh site actually needs
   in production.
10. **Yu-Gi-Oh production launch.**
    Own Vercel project, own domain, own environment variables. Public.
11. **One Piece research / build.**
    Repeat steps 2 → 10 for One Piece as an independent product.
12. **Lorcana research / build.**
    Repeat steps 2 → 10 for Lorcana as an independent product.
13. **Hub and admin expansion.**
    Build out `apps/hub` (network umbrella site) and `apps/admin` (control
    centre) once the specialist sites have generated concrete needs.

## Guardrails

- Do not begin a slice before the previous one is complete.
- Do not build generic multi-game components while working on Yu-Gi-Oh.
  When One Piece and Lorcana arrive they get their own designs.
- Extract into a shared package only when duplication is real and
  identical — not to preempt.
