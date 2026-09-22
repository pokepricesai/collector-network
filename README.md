# Collector Network

Monorepo for the Collector Network family of TCG sites.

## Sites in this repository

| App              | Purpose                                        | Status         |
| ---------------- | ---------------------------------------------- | -------------- |
| `apps/yugioh`    | Yu-Gi-Oh specialist site                       | Initialised    |
| `apps/onepiece`  | One Piece Card Game specialist site            | Placeholder    |
| `apps/lorcana`   | Disney Lorcana specialist site                 | Placeholder    |
| `apps/hub`       | Central network hub (umbrella marketing site)  | Placeholder    |
| `apps/admin`     | Central admin / control centre                 | Placeholder    |

## Sites NOT in this repository

- **PokePrices** — remains in its own existing repository.
- **MTGPrices** — remains in its own existing repository.

Both continue to consume the same shared Supabase project as the sites in this monorepo.

## Product principle

Shared infrastructure is encouraged. Shared **public product design is not.**

Each specialist site must have its own branding, UX, information architecture,
terminology, card-page design, homepage, market features, gameplay features,
visual language and editorial identity.

Generic cross-game `CardPage`, `Homepage`, `SetPage` etc. components are
explicitly out of scope. There is no shared `packages/ui`.

## Repository structure

```
collector-network/
  apps/
    yugioh/       # Initialised Next.js app (foundation only)
    onepiece/     # Placeholder — do not build yet
    lorcana/      # Placeholder — do not build yet
    hub/          # Placeholder — do not build yet
    admin/        # Placeholder — do not build yet
  packages/
    database/         # Future Supabase client / types / query infra
    auth/             # Future shared auth infra
    market-data/      # Future shared TCG market-read logic
    affiliate/        # Future eBay / affiliate tracking
    analytics/        # Future GA / event tracking
    seo/              # Future common technical SEO helpers
    network-config/   # Game identifiers and cross-site constants
  docs/
    architecture.md
    build-order.md
```

## Tooling

- **Package manager:** pnpm workspaces (`pnpm@9.15.0`)
- **Task runner:** Turborepo 2.x
- **Language:** TypeScript 5.x
- **Framework:** Next.js 15 (App Router) for apps

## Requirements

- Node.js `>= 20.11.0` (Node 24 LTS supported)
- pnpm `>= 9.0.0`

## Root commands

```bash
pnpm install     # install everything
pnpm dev         # run dev servers (currently only Yu-Gi-Oh)
pnpm build       # build all apps and packages
pnpm lint        # lint everything
pnpm typecheck   # typecheck everything
```

## Deployment model

This is a **single GitHub repository** deployed as **multiple independent
Vercel projects**. Each app has its own project, environment variables and
production domain.

| App              | Vercel project        | Domain                     |
| ---------------- | --------------------- | -------------------------- |
| `apps/yugioh`    | Separate project      | Separate production domain |
| `apps/onepiece`  | Separate project      | Separate production domain |
| `apps/lorcana`   | Separate project      | Separate production domain |
| `apps/hub`       | Separate project      | Umbrella / hub domain      |
| `apps/admin`     | Separate project      | Private admin domain       |

No production Vercel projects are configured yet. When they are, each project's
**Root Directory** setting will point at the relevant `apps/<name>` directory.

## Shared database

All network sites — including the two external repositories — will ultimately
read from the same shared Supabase project. See `docs/architecture.md` for the
schema summary. No credentials or client code are present in this repository
yet.
