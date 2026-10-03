import 'server-only';

// Page-opportunity engine (V1).
//
// Identifies SEO page templates we COULD build but have not. This
// Phase does NOT auto-build anything — the output is a research
// list for Luke/AI to decide on.
//
// Evidence sources:
//   • Site-specific template catalog (hardcoded per slug — reflects
//     what makes sense for each TCG).
//   • GSC `network_gsc_query_daily` demand signals.
//   • Sitemap existence check (does the site already have /artists/
//     etc? If so, mark as "existing").
//
// The engine deliberately does NOT fabricate search volume. It
// shows real GSC impressions for related queries and lets a human
// decide.

import type { SupabaseClient } from '@supabase/supabase-js';

interface Template {
  kind: string;
  label: string;
  queryPatterns: Array<RegExp>;
  pathPatterns: Array<RegExp>;
  reason: string;
}

const CATALOGS: Record<string, Template[]> = {
  pokemon: [
    { kind: 'species_pages',    label: 'Pokemon species pages',   queryPatterns: [/\b(pikachu|charizard|mewtwo|bulbasaur|snorlax|eevee|dragonite|gyarados|lugia|rayquaza|arceus)\b/i], pathPatterns: [/\/species\//, /\/pokemon\//], reason: 'Named-species queries have strong demand and dedicated pages aggregate card value across sets.' },
    { kind: 'artist_pages',     label: 'Illustrator / artist pages', queryPatterns: [/\b(illustrator|artist|arita|mitsuhiro|nakamura|yoshida|komiyama)\b/i], pathPatterns: [/\/artists?\//, /\/illustrators?\//], reason: 'Illustrator-collectors search by artist; a dedicated hub attracts long-tail queries.' },
    { kind: 'rarity_pages',     label: 'Rarity index pages',      queryPatterns: [/\b(secret rare|rainbow rare|hyper rare|alt art|ultra rare|promo)\b/i], pathPatterns: [/\/rarity\//, /\/rarities\//], reason: 'Users shop by rarity treatment; indexed by set + rarity.' },
    { kind: 'promo_indexes',    label: 'Promo card indexes',      queryPatterns: [/\b(promo|promotional|special|pre-?release)\b/i], pathPatterns: [/\/promos?\//, /\/promo-cards?\//], reason: 'Promos sit outside normal set hierarchies; dedicated indexes capture that long tail.' },
    { kind: 'set_value_pages',  label: '"Most valuable cards in <set>"', queryPatterns: [/\b(most valuable|top value|best cards|price list)\b/i], pathPatterns: [/\/most-valuable\//, /\/top-cards\//, /\/value\//], reason: '"Most valuable X" is a reliable high-impression query template.' },
    { kind: 'graded_pages',     label: 'Graded (PSA/BGS) collection pages', queryPatterns: [/\b(psa\s*\d+|bgs|graded|cgc|slabbed)\b/i], pathPatterns: [/\/graded\//, /\/psa\//], reason: 'Graded collectors search by grade + card combo; dedicated grading pages aggregate pop reports.' },
  ],
  mtg: [
    { kind: 'artist_pages',     label: 'MTG artist pages',        queryPatterns: [/\b(artist|illustrator|rebecca guay|john avon|john-?boy)\b/i], pathPatterns: [/\/artists?\//], reason: 'MTG artist pages aggregate across printings and support long-tail illustrator searches.' },
    { kind: 'colour_pages',     label: 'Colour index pages',      queryPatterns: [/\b(white|blue|black|red|green|multicolor|colorless)\s+(cards|commander|deck)/i], pathPatterns: [/\/colou?rs?\//, /\/mono-/], reason: 'Colour-filter searches are extremely common; dedicated colour hubs are a classic MTG SEO template.' },
    { kind: 'commander_pages',  label: 'Commander format pages',  queryPatterns: [/\b(commander|edh|edhrec)\b/i], pathPatterns: [/\/commander\//, /\/edh\//], reason: 'Commander format demand is huge; dedicated commander hubs capture format-specific intent.' },
    { kind: 'mechanics_pages',  label: 'Mechanic / keyword pages',queryPatterns: [/\b(flashback|cascade|convoke|flying|lifelink|deathtouch|hexproof|cycling)\b/i], pathPatterns: [/\/mechanics?\//, /\/keywords?\//], reason: 'Mechanic queries are evergreen and support cross-set card discovery.' },
    { kind: 'format_pages',     label: 'Format index pages',      queryPatterns: [/\b(standard|modern|legacy|vintage|pioneer|pauper)\b/i], pathPatterns: [/\/formats?\//, /\/standard\//, /\/modern\//], reason: 'Format-first browsing is how most MTG players shop.' },
    { kind: 'set_value_pages',  label: '"Most valuable" set pages', queryPatterns: [/\b(most valuable|top value|price list|chase)\b/i], pathPatterns: [/\/most-valuable\//, /\/top-cards\//], reason: '"Most valuable X" is a high-impression evergreen template.' },
    { kind: 'reprint_pages',    label: 'Reprint history pages',   queryPatterns: [/\b(reprint|reprinted|reprint history)\b/i], pathPatterns: [/\/reprints?\//], reason: 'Reprint-sensitive buying is a core MTG use case.' },
    { kind: 'year_pages',       label: '"Cards by year" pages',   queryPatterns: [/\b(cards?\s+by\s+year|19\d\d|20\d\d|release year)\b/i], pathPatterns: [/\/year\//, /\/years\//], reason: 'Chronological collection pages help with completionist searches.' },
  ],
  ygo: [
    { kind: 'archetype_pages',  label: 'Archetype hub pages',     queryPatterns: [/\b(archetype|blue-?eyes|dark magician|sky striker|salamangreat|branded)\b/i], pathPatterns: [/\/archetypes?\//], reason: 'Yu-Gi-Oh! competitive play is archetype-driven; dedicated hubs are a staple.' },
    { kind: 'monster_type_pages', label: 'Monster type pages',    queryPatterns: [/\b(dragon|spellcaster|warrior|fiend|machine|zombie)\s+(monster|cards|deck)/i], pathPatterns: [/\/types?\//], reason: 'Type-filter searches support deckbuilding.' },
    { kind: 'rarity_pages',     label: 'Rarity index pages',      queryPatterns: [/\b(secret rare|ultimate rare|starlight|collector\'?s rare|quarter century)\b/i], pathPatterns: [/\/rarity\//, /\/rarities\//], reason: 'Rarity-first browsing is primary in Yu-Gi-Oh! chase hunting.' },
    { kind: 'set_value_pages',  label: '"Most valuable" set pages', queryPatterns: [/\b(most valuable|top value|chase cards?)\b/i], pathPatterns: [/\/most-valuable\//], reason: 'Reliable high-impression evergreen template.' },
    { kind: 'card_family_pages',label: 'Card family / series pages', queryPatterns: [/\b(blue-?eyes|dark magician|exodia|elemental hero|cyber dragon)\b/i], pathPatterns: [/\/families?\//, /\/series\//], reason: 'Legacy card series retain long-tail demand decades after release.' },
  ],
  onepiece: [
    { kind: 'character_pages',  label: 'Character hub pages',     queryPatterns: [/\b(luffy|zoro|nami|sanji|chopper|robin|franky|brook|ace|law)\b/i], pathPatterns: [/\/characters?\//], reason: 'Franchise characters are the primary browsing axis for One Piece card collectors.' },
    { kind: 'leader_pages',     label: 'Leader card pages',       queryPatterns: [/\bleader\b/i], pathPatterns: [/\/leaders?\//], reason: 'Leaders anchor deck strategy; dedicated hubs serve high intent.' },
    { kind: 'colour_pages',     label: 'Colour index pages',      queryPatterns: [/\b(red|green|blue|purple|yellow|black)\s+(deck|leader|cards)/i], pathPatterns: [/\/colou?rs?\//], reason: 'Colour-first filtering is central to One Piece deckbuilding.' },
    { kind: 'set_value_pages',  label: '"Most valuable" set pages', queryPatterns: [/\b(most valuable|chase cards?|top cards?)\b/i], pathPatterns: [/\/most-valuable\//], reason: 'Evergreen value-template demand.' },
    { kind: 'rarity_pages',     label: 'Rarity / treatment pages',queryPatterns: [/\b(secret rare|super rare|alternate art|manga rare|parallel)\b/i], pathPatterns: [/\/rarity\//, /\/rarities\//], reason: 'OP TCG has distinctive rarity treatments collectors shop by.' },
  ],
  lorcana: [
    { kind: 'character_pages',  label: 'Character hub pages',     queryPatterns: [/\b(mickey|elsa|moana|ariel|belle|aladdin|simba|hercules)\b/i], pathPatterns: [/\/characters?\//], reason: 'Franchise characters drive Lorcana browsing.' },
    { kind: 'ink_pages',        label: 'Ink type pages',          queryPatterns: [/\b(amber|amethyst|emerald|ruby|sapphire|steel)\s+(ink|deck|cards)/i], pathPatterns: [/\/inks?\//], reason: 'Ink-filter searches are the primary deckbuilding axis in Lorcana.' },
    { kind: 'rarity_pages',     label: 'Rarity / treatment pages',queryPatterns: [/\b(enchanted|legendary|super rare|rare)\s+(cards|lorcana)/i], pathPatterns: [/\/rarity\//, /\/enchanted\//], reason: 'Enchanted / Legendary chase cards drive high-impression queries.' },
    { kind: 'set_value_pages',  label: '"Most valuable" set pages', queryPatterns: [/\b(most valuable|chase cards?|top cards?)\b/i], pathPatterns: [/\/most-valuable\//], reason: 'Evergreen value-template demand.' },
    { kind: 'franchise_pages',  label: 'Franchise / theme pages', queryPatterns: [/\b(frozen|moana|lion king|aladdin|hercules)\s+(cards|lorcana)/i], pathPatterns: [/\/franchise\//, /\/theme\//], reason: 'Theme hubs aggregate Disney IP cards across sets.' },
  ],
};

export async function generatePageOpportunities(
  sb: SupabaseClient,
  siteSlug: string,
  siteId: string,
  today: Date,
): Promise<{ generated: number; updated: number }> {
  const catalog = CATALOGS[siteSlug] ?? [];
  if (catalog.length === 0) return { generated: 0, updated: 0 };

  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - 28);
  const sinceIso = since.toISOString().slice(0, 10);

  // Pull last-28d queries + impressions.
  interface QueryRow { query: string; clicks: number; impressions: number }
  const qrows: QueryRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('network_gsc_query_daily')
      .select('query,clicks,impressions')
      .eq('site_id', siteId)
      .gte('date', sinceIso)
      .range(from, from + 1000 - 1);
    if (error) throw new Error(`[page-opps] query_daily: ${error.message}`);
    const rows = (data ?? []) as unknown as QueryRow[];
    qrows.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
    if (from > 1_000_000) break;
  }
  const queryTotals = new Map<string, { clicks: number; impressions: number }>();
  for (const r of qrows) {
    if (!r.query) continue;
    const p = queryTotals.get(r.query);
    if (!p) queryTotals.set(r.query, { clicks: r.clicks, impressions: r.impressions });
    else { p.clicks += r.clicks; p.impressions += r.impressions; }
  }

  // Pull latest sitemap snapshot URL list to check template existence.
  const { data: snap } = await sb
    .from('network_sitemap_snapshots')
    .select('metadata')
    .eq('site_id', siteId)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const shardMeta = (snap as { metadata?: { shards?: Array<{ url: string }> } } | null)?.metadata?.shards ?? [];
  const sitemapHints = new Set(shardMeta.map((s) => s.url));

  let generated = 0;
  let updated = 0;

  for (const tpl of catalog) {
    // Related queries + evidence.
    let impressions = 0;
    let clicks = 0;
    const related: Array<{ q: string; imp: number }> = [];
    for (const [q, m] of queryTotals) {
      if (tpl.queryPatterns.some((re) => re.test(q))) {
        impressions += m.impressions;
        clicks += m.clicks;
        related.push({ q, imp: m.impressions });
      }
    }
    related.sort((a, b) => b.imp - a.imp);
    const relatedQueries = related.slice(0, 10).map((r) => r.q);

    // Existence probe (crude): check if any sitemap shard URL
    // suggests this template exists.
    const templateExists = tpl.pathPatterns.some((re) =>
      [...sitemapHints].some((u) => re.test(u))
    );

    // We propose a template when there's at least some demand OR when
    // the catalog says it's a known evergreen opportunity even if GSC
    // demand is tiny today.
    const priority: 'critical' | 'high' | 'normal' | 'low' =
      impressions >= 10_000 ? 'high' :
      impressions >= 1_000  ? 'normal' : 'low';

    const buildStatus = templateExists ? 'live' : 'proposed';
    const status = templateExists ? 'actioned' : 'open';

    const { data: existing } = await sb
      .from('network_page_opportunities')
      .select('id')
      .eq('site_id', siteId)
      .eq('kind', tpl.kind)
      .eq('template_label', tpl.label)
      .maybeSingle();

    const row = {
      site_id: siteId,
      kind: tpl.kind,
      template_label: tpl.label,
      reason: tpl.reason,
      priority,
      available_count: 0, // we don't yet have an entity catalog to count against
      gsc_impressions_28d: impressions,
      gsc_clicks_28d: clicks,
      related_queries: relatedQueries,
      evidence: { related_queries_full: related.slice(0, 50), template_exists_hint: templateExists },
      build_status: buildStatus,
      status,
    };
    if (!existing) {
      const { error } = await sb.from('network_page_opportunities').insert(row);
      if (!error) generated++;
    } else {
      const { error } = await sb.from('network_page_opportunities')
        .update({
          priority: row.priority,
          gsc_impressions_28d: row.gsc_impressions_28d,
          gsc_clicks_28d: row.gsc_clicks_28d,
          related_queries: row.related_queries,
          evidence: row.evidence,
          build_status: row.build_status,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id);
      if (!error) updated++;
    }
  }
  return { generated, updated };
}
