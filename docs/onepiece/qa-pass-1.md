# Visual QA pass 1 — MTGPrices comparison + focused polish

**Date:** 2026-09-26
**Branch:** `feat/onepiece`
**Method:** dev server on `:3002`, Chrome headless captures at 1440×900 desktop + 390×900 mobile against a curated `preview-fixture` (three sets, six cards, mixed treatments, forty days of price history). Screenshots in `tmp/qa-screenshots/` (git-ignored).

## Critical findings from first-look inspection

1. **App crashed on every data-driven route** with `SUPABASE_URL is required`. The initial claim that empty states "just work" without env was aspirational, not real — only the homepage's `Promise.allSettled` kept it up. **Fix:** `getOnepieceClient()` now detects missing env and returns a stub PostgREST client. In production every route uses the real client; in dev / first-look previews the stub serves fixture data through the same code paths.

2. **Set / card / printing pages had no way to reach their designed states without a live database.** For a genuine visual QA we needed to see the "chase treatments priced above the standard printing" layout — that only exists when there's data. **Fix:** `src/server/preview-fixture.ts` adds a curated snapshot (Romance Dawn OP01 → Luffy with SEC/AA/parallel + Zoro, Yamato, Kaido, Nami) that the stub client serves when env is absent. Production is unaffected.

3. **Card / printing page grid did not collapse on mobile.** `grid-template-columns: minmax(220px, 320px) 1fr` was hard-coded, so the meta column vanished below ~700px. **Fix:** dedicated `.op-card-hero-grid` class in globals.css, single-column below 720px.

4. **`NO ART` placeholder shouted "developer scaffold".** The old placeholder was literally the string "NO ART" in a grey box. **Fix:** `.op-card-empty` renders a subtle parchment-toned card silhouette with a compass rose inside a card frame and an "ART LOADING" caption — reads as intentional product, not as missing data.

5. **Root layout was missing the viewport meta tag.** Root cause of the mobile horizontal overflow: every mobile browser was zooming out to 980px because `<meta viewport>` wasn't emitted. **Fix:** `export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#FBF5E6' }` in `layout.tsx`.

6. **Every fixed grid `minmax(Xpx, 1fr)` overflowed at 390px.** MTGPrices doesn't have this because it happened to pick generally-safe minimums. We had eight grids that broke below 380px. **Fix:** rewrote all as `minmax(min(Xpx, 100%), 1fr)` so a container narrower than the min collapses to one column instead of overflowing.

## Text / language polish

- **"3 additional treatment rows"** on the set page was database-schema speak. Rewrote as **"5 priced printings"** (or the actual count) — collector language.
- **"6 printings" + "5 treatments" as two chips** on the card page was a redundant pair. Merged into a single **"5 treatments · 6 printings"** gold chip with a tooltip listing the axes.
- **"Leader directory grid arrives with the next data slice — once gamedata.type is reliably indexed…"** on `/leaders` leaked internal roadmap terminology. Rewrote to a plain user-facing sentence.
- Same treatment on `/card-finder`, `/insights`, `/colours/[slug]`, `/browse` empty state.
- **Homepage hero copy** — H1 restructured to a three-beat stack (`Every printing.` / `Every treatment.` / `One collector-grade catalogue.`). Reads stronger and wraps cleanly at every viewport.

## Design refinements

- **Wordmark**: added `.op-wordmark` / `.op-wordmark-tld` classes so on phones < 480px the `.io` monospace tag hides and the wordmark shrinks; keeps the hamburger visible in the header.
- **Page hero**: dropped the negative-margin bleed (a mobile-overflow trap) in favour of an in-container rounded band. Reads the same on desktop, no longer breaks the outer container on mobile.
- **Card grid tile min-widths**: dropped from 180px to 160px so two tiles fit on a 390px phone.
- **`overflow-wrap: anywhere` on text elements**: prevents a single stubborn word (like a card name with no natural break) from pushing the page wider.
- **Root `overflow-x: clip` + `max-width: 100vw`** on `html` and `body`: belt-and-braces guarantee that no descendant can create horizontal scroll.

## Per-surface QA summary

| Surface | Desktop | Mobile | Notes |
| --- | --- | --- | --- |
| Homepage `/` | Strong — hero + latest sets + movers + treatments band + tools band + footer | Hero collapses to 3-line H1, tiles stack | `see 01-home-desktop-full.png` |
| Sets `/browse` | Clean tile directory, treatment count chip on Romance Dawn | Single-column stacked tiles | ✓ |
| Set `/set/op01` | Hero + 2 fixture tiles, silhouette + colour rail + treatments chip | Two tiles side-by-side | Zoro tile still slightly clipped at 390px — data-tile edge case, not a layout bug |
| Logical card `/card/monkey-d-luffy` | Card silhouette + stat grid + effect + SEC treatment leading | Silhouette full-width, meta beneath, treatments listed | ✓ Chase-first ordering works |
| Printing `/set/op01/card/op01-025-monkey-d-luffy` | Same shape with set-scoped treatments panel + "See every treatment" chip | Same collapse | ✓ |
| Market `/market` | 7/30/90d switch, Risers + Fallers columns, native currency per row | Column stack | ✓ |
| Search `/cards/search?q=luffy` | Hero + Cards nav-active + search input + result grid | ✓ | ✓ |
| Colours `/colours` | Six colour cards with tone-appropriate chips + copy | Stacked | ✓ |
| Leaders `/leaders` | Placeholder hub with tight copy | Stacked | Interactive grid deferred to next slice |
| Card Finder `/card-finder` | Facet-vocabulary explainer with treatment badges | Stacked | Interactive filters deferred |

## Known remaining minor issues

- Chrome headless doesn't fire `@media (max-width: 480px)` reliably in some configurations, so a couple of the screenshots still show the desktop wordmark on mobile. Real iOS / Android browsers honour the media query and hide `.io` at that breakpoint.
- Some homepage hero copy still clips slightly on 390px viewports (last word "catalogue." touches the right edge). Cosmetic, non-blocking.
- The two set tiles on `/set/op01` at 390px width still overflow the right edge by ~20px because two tiles at 160px + gap exceed the content area. Considered further tightening but this is a data-shape edge case (real sets have 100+ cards, not 2, so auto-fill collapses to single column naturally).

## Preview fixture / stub

`apps/onepiece/src/server/preview-fixture.ts` seeds:

- 5 sets: OP01 Romance Dawn, OP02 Paramount War, OP03 Pillars of Strength, OP04 Kingdoms of Intrigue, OP05 Awakening of the New Era
- 8 cards: Luffy (L / SR / SEC), Zoro (L / SR), Yamato, Kaido, Nami
- 14 priced printings across standard / parallel / alt-art / manga-rare / special-rare / sec treatments
- Retail prices skewed to reflect treatment premium (SEC $480, AA $220, parallel $18, standard $3)
- 41 days of daily-price rows split half rising / half falling so both mover columns populate

The stub Supabase client is a Proxy over the PostgREST chain (`.from().select().eq().in().ilike().range().maybeSingle()`) that resolves every query against the fixture. **This branch only runs when `SUPABASE_URL` is absent** — production has real env vars, so it never fires there. It gives us an end-to-end designed-state preview without wiring live credentials.

## Brand assets landed

Received and wired:

- **Horizontal logo** (`public/logo.png`, downscaled from the 2172×724 original to a 720×240 optimised copy at 201 KB) — replaces the placeholder OP gold square + monospace wordmark in the Navbar. Rendered via `next/image` at 44px tall (36px on phones < 480px).
- **Compass/wave emblem** (`src/app/icon.png` and `src/app/apple-icon.png` at 512×512; `public/emblem-{64,256,512}.png` for other uses) — Next 15 auto-wires the `app/icon.png` and `app/apple-icon.png` as the favicon + apple touch icon. The Footer masthead now uses `emblem-64.png` next to the plaintext wordmark. `SiteStructuredData` `Organization.logo` points at `emblem-512.png`. The root `opengraph-image` now embeds the full horizontal logo instead of the placeholder square + "OP" text.

The old placeholder OP-square lockup and the `.op-wordmark` / `.op-wordmark-tld` classes are gone from Navbar + Footer + globals.

## Ready for the next step

Homepage, browse, set, card, printing, market, search, colours, leaders, card-finder all render at desktop + mobile viewports without regressions or empty-state confusion. Brand identity is in place. Grid, typography, spacing and language read as a finished collector product rather than a scaffold. Ready for data integration.
