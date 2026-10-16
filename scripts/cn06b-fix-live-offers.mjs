// CN-06B Phase 5: correct the live-capability offer catalog.
//
// Manual probes against production this hour revealed:
//   • /insights         → 200 on all 5 sites. insight_article_sponsor OK.
//   • /collection       → login-gated 307 on MTG/YGO/OP/Lorcana. 404 on PokePrices.
//   • /watchlist        → similar pattern; absent on PokePrices.
//   • /market/graded    → 200 on YGO only (verified). 404 on PokePrices,
//                         OnePiece, Lorcana. MTG serves /graded (200).
//
// Therefore the previously claimed is_live_capability placements for
// graded + collection need their placement_sites narrowed to what we
// actually ship today. The offer rows stay live-capability where we
// can deliver on at least one site — just honest about which.

import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc';
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const CORRECTIONS = [
  {
    slug: 'insight_article_sponsor',
    placement_sites: ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'],
    is_live_capability: true,
    development_notes: null,
  },
  {
    slug: 'collection_feature_sponsor',
    placement_sites: ['mtg', 'ygo', 'onepiece', 'lorcana'],
    is_live_capability: true,
    development_notes: 'PokePrices does not have a /collection page — placement not available there.',
  },
  {
    slug: 'graded_cta_single_site',
    placement_sites: ['mtg', 'ygo'],
    is_live_capability: true,
    development_notes: 'Delivered on MTG (/graded) and YGO (/market/graded). Pokemon does not yet have a graded market page; needs build to extend.',
  },
  {
    slug: 'graded_cta_network_wide',
    placement_sites: ['mtg', 'ygo'],
    is_live_capability: false,
    development_notes: 'Network-wide requires graded pages on Pokemon, OnePiece and Lorcana. Those surfaces do not exist yet — needs build before this can honestly be sold as network-wide.',
  },
  {
    slug: 'graded_consignment_cta',
    placement_sites: ['mtg', 'ygo'],
    is_live_capability: true,
    development_notes: 'Pokemon graded page not yet live. Deliverable on MTG + YGO today; add Pokemon when the graded surface ships.',
  },
];

for (const c of CORRECTIONS) {
  const { error } = await sb.from('crm_vendor_offers')
    .update({
      placement_sites: c.placement_sites,
      is_live_capability: c.is_live_capability,
      development_notes: c.development_notes,
    })
    .eq('slug', c.slug);
  if (error) {
    console.error(`[cn06b-fix-offers] ${c.slug}: ${error.message}`);
    continue;
  }
  console.log(`[cn06b-fix-offers] ${c.slug.padEnd(32)} live=${c.is_live_capability} sites=${c.placement_sites.join(',')}`);
}

// Add 3 credible intro packages, deduped by slug.
const INTRO_PACKAGES = [
  {
    category_code: 'grading_authentication',
    slug: 'intro_grading_insights_pokemon',
    display_name: 'Grading intro — PokePrices insights sponsorship',
    description: 'One sponsored editorial insight piece on PokePrices referencing the grader + 30-day CTA retention in the sidebar. Primary audience: Pokemon collectors already evaluating value, the natural grading-submission moment.',
    placement_sites: ['pokemon'],
    price_minor: 30000,
    tier: 'entry',
    is_live_capability: true,
    development_notes: null,
  },
  {
    category_code: 'online_tcg_retailer',
    slug: 'intro_retailer_insights_mtg',
    display_name: 'Retailer intro — MTG insights sponsorship',
    description: 'One sponsored editorial insight piece on MTGPrices referencing the retailer + 30-day sidebar CTA. Audience: MTG collectors on the pricing + market side of the site.',
    placement_sites: ['mtg'],
    price_minor: 30000,
    tier: 'entry',
    is_live_capability: true,
    development_notes: null,
  },
  {
    category_code: 'accessories',
    slug: 'intro_accessories_insights_network',
    display_name: 'Accessories intro — multi-site insights sponsorship',
    description: 'One sponsored editorial insight piece on any three Collector Network sites referencing the accessory brand + 30-day sidebar follow-up on those sites. Audience: collectors managing their inventories, binders and storage.',
    placement_sites: ['pokemon', 'mtg', 'ygo'],
    price_minor: 30000,
    tier: 'entry',
    is_live_capability: true,
    development_notes: null,
  },
];

for (const p of INTRO_PACKAGES) {
  const existing = await sb.from('crm_vendor_offers').select('id').eq('slug', p.slug).maybeSingle();
  if (existing.data) {
    const { error } = await sb.from('crm_vendor_offers').update(p).eq('id', existing.data.id);
    if (error) console.error(`[cn06b-fix-offers] intro-update ${p.slug}: ${error.message}`);
    else console.log(`[cn06b-fix-offers] intro-updated ${p.slug}`);
  } else {
    const { error } = await sb.from('crm_vendor_offers').insert(p);
    if (error) console.error(`[cn06b-fix-offers] intro-insert ${p.slug}: ${error.message}`);
    else console.log(`[cn06b-fix-offers] intro-inserted ${p.slug}`);
  }
}

console.log('[cn06b-fix-offers] done.');
