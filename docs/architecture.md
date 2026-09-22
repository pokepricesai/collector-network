# Architecture

## Five-site Collector Network

The Collector Network is a family of five independent public sites, each
serving one Trading Card Game community, plus internal support surfaces.

| Site        | Game                        | Repository                | Vercel project     |
| ----------- | --------------------------- | ------------------------- | ------------------ |
| PokePrices  | Pokémon TCG                 | **External** (own repo)   | Independent        |
| MTGPrices   | Magic: The Gathering        | **External** (own repo)   | Independent        |
| Yu-Gi-Oh    | Yu-Gi-Oh                    | This repo (`apps/yugioh`) | Independent (new)  |
| One Piece   | One Piece Card Game         | This repo (`apps/onepiece`) | Independent (new)  |
| Lorcana     | Disney Lorcana              | This repo (`apps/lorcana`) | Independent (new)  |

Plus:

- `apps/hub` — the umbrella / network hub site.
- `apps/admin` — private admin / control centre.

## Why one repo but many projects

The three new specialist sites plus hub and admin live in a **single**
GitHub repository because they:

- share infrastructure primitives (database access, auth, market data, SEO,
  analytics, affiliate, cross-site constants),
- benefit from atomic changes across infrastructure and consumers,
- benefit from a single dependency graph and lockfile.

Each site nevertheless deploys as its **own Vercel project**, with its own
build command, environment variables and production domain. This is set up
per-project by configuring **Root Directory** = `apps/<name>` in Vercel.

Deployment isolation guarantees:

- one site's outage or bad deploy cannot take down another,
- each site can iterate on its own release cadence,
- each site has a distinct edge cache, log stream and analytics scope,
- each site has independent domain, DNS and SSL,
- environment variables and secrets never leak across sites.

## PokePrices and MTGPrices

**Out of this repo.** They remain in their existing repositories and are not
touched by this project. They will continue to consume the same shared
Supabase project. Any future migration into the monorepo is an explicit,
separate decision — not a goal.

## Hub and admin

- **Hub** is the network-level umbrella site: an editorial front door that
  explains the network and drives traffic to the specialist sites.
- **Admin** is a private control centre used by the operator to observe and
  manage the entire network.

Both are placeholder directories today. Neither has any frontend built.

## Shared Supabase database

All network sites (internal + external) read from the same Supabase project.
The relevant shared tables are:

- `tcg_games` — canonical game rows (Pokémon, Magic, Yu-Gi-Oh, One Piece,
  Lorcana).
- `tcg_sets` — expansions / releases per game.
- `tcg_cards` — the game-independent card entity.
- `tcg_printings` — each physical printing of a card in a set.
- `tcg_external_ids` — mappings between our IDs and external sources.
- `tcg_market_prices_current` — latest raw market prices.
- `tcg_market_price_daily` — daily raw market price history.
- `tcg_graded_prices_current` — latest graded (PSA/BGS/CGC) prices.
- `tcg_graded_price_daily` — daily graded price history.

Query patterns and schema evolution are shared. Presentation is not.

No production credentials are stored in this repository. Sites gain
credentials as they enter later slices via their own Vercel environment
variables.

## Independent Vercel projects and domains

Each app is a separate Vercel project. Environment variables, custom domains,
build settings and analytics all live at the project level. This monorepo
supplies the source code and the shared workspace; it does not couple the
apps together at runtime.

## Shared infrastructure, distinct product identity

The **hard product principle** of this project:

- **Infrastructure is shared.** Database access, price reads, auth, SEO
  technical helpers, affiliate link plumbing, analytics event vocabulary and
  cross-site constants live in `packages/*` and are consumed by every site.
- **Public product design is not.** Each specialist site has its own
  branding, information architecture, terminology, homepage, card page, set
  page, market visualisations, gameplay features, visual language and
  editorial voice.

For that reason there is **no `packages/ui`** and there are **no cross-game
"generic CardPage / Homepage / SetPage" components**. Site-shaped components
live under `apps/<site>/src/**` and are owned by that site alone. If a truly
generic primitive proves worthwhile later, it will be extracted only after
that value is real and explicit — never on speculation.
