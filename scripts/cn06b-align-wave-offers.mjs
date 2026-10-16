// CN-06B Phase 6 prep: ensure every first-wave prospect has a
// recommended_offer_id that we can actually deliver today
// (is_live_capability = true). For wave prospects currently pointing
// at a build-needed offer, remap to the aligned live-capability offer.

import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc';
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

// Load all live-capability offers for category mapping.
const live = await sb.from('crm_vendor_offers')
  .select('id, slug, category_code, price_minor, display_name, placement_sites')
  .eq('is_live_capability', true);
if (live.error) throw new Error(live.error.message);
const liveById = new Map(live.data.map((o) => [o.id, o]));
const liveByCategory = new Map();
for (const o of live.data) {
  const arr = liveByCategory.get(o.category_code) ?? [];
  arr.push(o);
  liveByCategory.set(o.category_code, arr);
}

// Fallback by category when there's no in-category live offer: use
// a reasonable network-level live offer (insight article is universal).
const INSIGHT_UNIVERSAL = live.data.find((o) => o.slug === 'insight_article_sponsor');
const INTRO_MTG = live.data.find((o) => o.slug === 'intro_retailer_insights_mtg');
const INTRO_POKEMON = live.data.find((o) => o.slug === 'intro_grading_insights_pokemon');
const INTRO_ACCESSORIES = live.data.find((o) => o.slug === 'intro_accessories_insights_network');
const COLLECTION_SPONSOR = live.data.find((o) => o.slug === 'collection_feature_sponsor');
const GRADED_CTA_SINGLE = live.data.find((o) => o.slug === 'graded_cta_single_site');
const GRADED_CONSIGN = live.data.find((o) => o.slug === 'graded_consignment_cta');

// Mapping: category → preferred live-capability offer for wave outreach.
const PREFERRED_LIVE = {
  grading_authentication: GRADED_CTA_SINGLE,
  online_tcg_retailer: INTRO_MTG, // most retailers lean MTG; adjust per-partner below
  lgs_online_hybrid: INSIGHT_UNIVERSAL,
  sealed_distributor: INTRO_MTG,
  singles_specialist: INSIGHT_UNIVERSAL,
  buylist: INSIGHT_UNIVERSAL,
  auction_consignment: GRADED_CONSIGN,
  marketplace_platform: INSIGHT_UNIVERSAL,
  accessories: INTRO_ACCESSORIES,
  display_premium: INSIGHT_UNIVERSAL,
  scanning_inventory: INSIGHT_UNIVERSAL,
  card_show_event: INSIGHT_UNIVERSAL,
  breaker_livestream: INSIGHT_UNIVERSAL,
  insurance: INSIGHT_UNIVERSAL,
  subscription_mystery: INSIGHT_UNIVERSAL,
  other_collector_business: INSIGHT_UNIVERSAL,
};

// Overrides for specific slugs where the retailer is Pokemon-first.
const SLUG_OVERRIDES = {
  'pokellector': INTRO_POKEMON,
  'collectr': COLLECTION_SPONSOR,
  'pokemon-database': INTRO_POKEMON,
};

const wave = await sb.from('network_partners')
  .select('id, slug, display_name, vendor_category, recommended_offer_id')
  .eq('first_wave', true);
if (wave.error) throw new Error(wave.error.message);

let remapped = 0;
let kept = 0;
for (const p of wave.data) {
  const currentOffer = p.recommended_offer_id ? liveById.get(p.recommended_offer_id) : null;
  if (currentOffer) { kept += 1; continue; } // Already live-capable.

  const target = SLUG_OVERRIDES[p.slug] ?? PREFERRED_LIVE[p.vendor_category] ?? INSIGHT_UNIVERSAL;
  if (!target) {
    console.log(`[align-offers] ${p.slug}: no live-capable offer matched for ${p.vendor_category}; leaving unchanged`);
    continue;
  }
  const { error } = await sb.from('network_partners')
    .update({ recommended_offer_id: target.id, recommended_price_minor: target.price_minor, recommended_currency: 'GBP' })
    .eq('id', p.id);
  if (error) {
    console.error(`[align-offers] ${p.slug}: ${error.message}`);
    continue;
  }
  console.log(`[align-offers] ${p.slug.padEnd(42)} → ${target.slug}  £${(target.price_minor / 100).toFixed(0)}/mo`);
  remapped += 1;
}

console.log(`[align-offers] remapped=${remapped} kept=${kept} total=${wave.data.length}`);
