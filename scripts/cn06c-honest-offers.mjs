// CN-06C Phase 3: make the offer catalogue honest about what the
// sites actually ship today.
//
// Site audit (manual probes, 2026-10-17):
//   • /insights pages exist on all 5 sites and render editorial articles.
//     We can publish a dedicated article today. BUT there is no
//     "Sponsored by" tag component anywhere, no sidebar sponsor module,
//     no CTA slot on any insights page. Sponsor acknowledgement would
//     be inline in the article (e.g. "This piece is published in
//     partnership with X").
//   • /collection and /watchlist exist on MTG/YGO/OP/Lorcana but are
//     login-gated. No sponsor slot on either.
//   • /graded (MTG) and /market/graded (YGO) exist but are purely
//     editorial. No sponsor slot.
//   • No cross-site ad server, no site-wide sidebar module.
//
// Honest state:
//   • Only one offer is deliverable today without any site code:
//     a dedicated "In partnership with X" editorial feature article
//     on one Collector Network site via the existing CN-04 publishing
//     pipeline. 12-month archive retention is automatic.
//   • Every other offer requires a slot/component build.
//
// What this script does:
//   1. Downgrades is_live_capability on everything we cannot ship.
//   2. Replaces the three intro packages with a single HONEST intro
//      package anchored at £300/mo and three "development required"
//      upgrades at higher tiers.
//   3. Preserves history by not deleting any catalogue rows.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const CORRECTIONS = [
  // The ONLY offer that is live without any dev.
  {
    slug: 'insight_article_sponsor',
    is_live_capability: true,
    placement_sites: ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'],
    description: 'A dedicated editorial feature article on one Collector Network site with an inline "In partnership with X" acknowledgement. 12-month archive retention automatic. One article per month. No sidebar CTA, no sponsor tag component — those require development.',
    development_notes: null,
  },
  // Everything else: honestly dev-required because the slot does not exist.
  {
    slug: 'collection_feature_sponsor',
    is_live_capability: false,
    placement_sites: ['mtg', 'ygo', 'onepiece', 'lorcana'],
    description: 'Brand sponsorship of the collection tracker + watchlist surfaces. Requires a sponsor-slot component on /collection and /watchlist. The pages exist but ship no sponsor module today.',
    development_notes: 'Requires building a sponsor-logo slot on collection + watchlist pages (login-gated). Estimated 2 days.',
  },
  {
    slug: 'graded_cta_single_site',
    is_live_capability: false,
    placement_sites: ['mtg', 'ygo'],
    description: 'A "Grade with X" CTA on /graded (MTG) and /market/graded (YGO). The graded pages exist but ship no CTA/sponsor slot today.',
    development_notes: 'Requires a CTA module on MTG /graded and YGO /market/graded. Estimated 1 day.',
  },
  {
    slug: 'graded_cta_network_wide',
    is_live_capability: false,
    placement_sites: ['mtg', 'ygo'],
    description: 'Grading CTA network-wide. Currently only MTG and YGO have graded pages, and neither has a CTA slot. Pokemon, One Piece and Lorcana lack the graded surface entirely.',
    development_notes: 'Requires graded surfaces + CTA slot. Multiple days of build before this is truthful as "network-wide".',
  },
  {
    slug: 'graded_consignment_cta',
    is_live_capability: false,
    placement_sites: ['mtg', 'ygo'],
    description: '"Consign your graded copy to X" CTA alongside PSA 10 panels on graded pages. Pages exist, CTA slot does not.',
    development_notes: 'Same CTA module as graded_cta_single_site. Can co-ship.',
  },
  // Legacy offers from CN-06A — all require dev; preserve development_notes.
  { slug: 'homepage_brand_strip', is_live_capability: false },
  { slug: 'featured_retailer_set_pages', is_live_capability: false },
  { slug: 'sealed_sidebar_release', is_live_capability: false },
  { slug: 'vintage_specialist_cta', is_live_capability: false },
  { slug: 'card_page_buylist_cta', is_live_capability: false },
  { slug: 'marketplace_logo_pricing', is_live_capability: false },
  { slug: 'graded_sidebar_display', is_live_capability: false },
  { slug: 'tool_directory_feature', is_live_capability: false },
  { slug: 'featured_event_listing', is_live_capability: false },
  { slug: 'release_breaker_sidebar', is_live_capability: false },
  { slug: 'sidebar_insurance_mention', is_live_capability: false },
  { slug: 'regional_lgs_listing', is_live_capability: false },
];

for (const c of CORRECTIONS) {
  const patch = { is_live_capability: c.is_live_capability };
  if (c.placement_sites !== undefined) patch.placement_sites = c.placement_sites;
  if (c.description !== undefined) patch.description = c.description;
  if (c.development_notes !== undefined) patch.development_notes = c.development_notes;
  const { error } = await sb.from('crm_vendor_offers').update(patch).eq('slug', c.slug);
  if (error) console.log(`[honest] ${c.slug}: ${error.message}`);
  else console.log(`[honest] ${c.slug.padEnd(34)} live=${c.is_live_capability}`);
}

// Replace the 3 CN-06B intro packages with ONE honest intro package.
// Deactivate the previous three.
const PRIOR_INTROS = ['intro_grading_insights_pokemon', 'intro_retailer_insights_mtg', 'intro_accessories_insights_network'];
for (const slug of PRIOR_INTROS) {
  const { error } = await sb.from('crm_vendor_offers').update({ is_active: false, is_live_capability: false,
    development_notes: 'Deprecated 2026-10-17 (CN-06C): claimed sidebar + CTA that do not exist. Superseded by cn06c_intro_feature_article.',
  }).eq('slug', slug);
  if (error) console.log(`[deprecate] ${slug}: ${error.message}`);
}

// Insert the single honest intro package. Non-category — attached to
// 'other_collector_business' so it covers everyone.
const introPackage = {
  category_code: 'other_collector_business',
  slug: 'cn06c_intro_feature_article',
  display_name: 'Intro — one in-partnership feature article per month',
  description: 'One dedicated editorial feature article per month on one Collector Network site of your choice (PokePrices, MTGPrices, YGOPrices, OnePiecePrices or LorcanaPrices). Inline "In partnership with [brand]" acknowledgement in the headline and intro paragraph. Articles stay in the /insights archive for the full 12-month term and remain crawlable afterwards. No sidebar CTAs, no sponsor tag component, no banners — those capabilities are development-required. Monthly placement report via email. £300 per month, 12-month term, cancellable with 30 days notice from month three.',
  placement_sites: ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'],
  price_minor: 30000,
  price_currency: 'GBP',
  term_months: 12,
  tier: 'entry',
  is_live_capability: true,
  development_notes: null,
  is_active: true,
};

const existing = await sb.from('crm_vendor_offers').select('id').eq('slug', introPackage.slug).maybeSingle();
if (existing.data) {
  const { error } = await sb.from('crm_vendor_offers').update(introPackage).eq('id', existing.data.id);
  if (error) console.log(`[intro] update: ${error.message}`);
  else console.log(`[intro] updated ${introPackage.slug}`);
} else {
  const { error } = await sb.from('crm_vendor_offers').insert(introPackage);
  if (error) console.log(`[intro] insert: ${error.message}`);
  else console.log(`[intro] inserted ${introPackage.slug}`);
}

// Add two higher-tier packages: 2 articles/month and 3 articles/month across multi-site.
const upgradePackages = [
  {
    category_code: 'other_collector_business',
    slug: 'cn06c_mid_two_articles',
    display_name: 'Standard — two feature articles per month',
    description: 'Two dedicated editorial feature articles per month on your chosen Collector Network site, with inline "In partnership with [brand]" acknowledgement. £500 per month, 12-month term, 30 days notice from month three.',
    placement_sites: ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'],
    price_minor: 50000,
    price_currency: 'GBP',
    term_months: 12,
    tier: 'standard',
    is_live_capability: true,
    is_active: true,
  },
  {
    category_code: 'other_collector_business',
    slug: 'cn06c_premium_multi_site',
    display_name: 'Premium — one feature article per month on three sites',
    description: 'One dedicated editorial feature article per month on three Collector Network sites of your choice, with inline "In partnership with [brand]" acknowledgement in each. £800 per month, 12-month term, 30 days notice from month three.',
    placement_sites: ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'],
    price_minor: 80000,
    price_currency: 'GBP',
    term_months: 12,
    tier: 'premium',
    is_live_capability: true,
    is_active: true,
  },
];

for (const p of upgradePackages) {
  const found = await sb.from('crm_vendor_offers').select('id').eq('slug', p.slug).maybeSingle();
  if (found.data) {
    const { error } = await sb.from('crm_vendor_offers').update(p).eq('id', found.data.id);
    if (error) console.log(`[upgrade] update ${p.slug}: ${error.message}`);
    else console.log(`[upgrade] updated ${p.slug}`);
  } else {
    const { error } = await sb.from('crm_vendor_offers').insert(p);
    if (error) console.log(`[upgrade] insert ${p.slug}: ${error.message}`);
    else console.log(`[upgrade] inserted ${p.slug}`);
  }
}

console.log('[honest] done.');
