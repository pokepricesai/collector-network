# apps/onepiece — One Piece Card Game specialist site

Next.js 15 App Router site that serves the One Piece Card Game community.
Structured as an adaptation of the proven MTGPrices product — same route
shape, same data-first collector focus, same SEO scaffolding — but
overhauled for One Piece semantics:

- Six-colour palette (Red / Green / Blue / Purple / Black / Yellow).
- Card types: Leader, Character, Event, Stage, DON!!.
- Fields: colour, cost, power, counter, life, attribute, trigger,
  type/crew, language.
- Treatments as first-class collectibles: standard, parallel, alternate
  art, manga rare, special rare, promo.
- English and Japanese versions treated as distinct printings.

## Data

Reads through the shared `@collector-network/database` +
`@collector-network/market-data` packages against the generic `tcg_*`
tables, scoped by `game_id`. No OP-specific tables are introduced in
this app.

## Local dev

```
pnpm --filter @collector-network/onepiece dev
```

Serves on port 3002 (Yu-Gi-Oh runs on 3001).

## Deployment

Independent Vercel project with root directory `apps/onepiece`. Its own
production domain, environment variables and analytics scope.
