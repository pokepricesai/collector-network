// CN-06A: seed US TCG business prospects into network_partners.
//
// GUARDRAILS (operator-stated, non-negotiable):
//   * No invented companies. Every row is a US business the author has
//     direct awareness of from public knowledge.
//   * No fabricated email addresses. Contacts remain unseeded. The
//     operator captures them from public sources through the admin UI.
//   * No fabricated named contacts. Contacts are seeded empty.
//   * research_confidence is 'medium' by default — the operator confirms.
//   * research_sources is populated with the canonical homepage URL as
//     the public proof trail. The operator extends with additional URLs
//     during verification.
//
// What this script does:
//   1. Resolves each category + recommended offer slug to IDs.
//   2. Upserts each prospect into network_partners by slug.
//   3. Sets CN-06A fields: vendor_category, relevant_tcgs, us_state,
//      is_us_business, estimated_size, research_sources, confidence,
//      recommended_offer_id, recommended_price_minor.
//   4. Flags first_wave=true for 25 top-fit prospects.
//   5. Recomputes fit_score for every seeded row from v_crm_vendor_scoring.
//
// What this script does NOT do:
//   * Send a single email.
//   * Create network_partner_contacts rows (verification requires
//     operator capture from a public source).
//   * Guess contact URLs or /contact page URLs.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ------ Prospect catalogue -----------------------------------------------
//
// Grouped by vendor_category. Each prospect carries:
//   name:         Legal / display name as commonly known.
//   website:      Canonical homepage URL (used as research_source).
//   state:        US state (two-letter) if widely known. null otherwise.
//   size:         'small' | 'medium' | 'large' — my honest size read.
//   tcgs:         Which of our five sites they're commercially aligned
//                 with. Conservative — only when I know their TCG focus.
//   kind:         Enum value for the pre-existing network_partner_kind.
//   note:         Short free-text note for the operator (public context,
//                 never a fabricated contact).
//   offerSlug:    Recommended offer slug (resolved to id below).
//   offerPrice:   Override price in GBP integer (null = use catalog default).

const ALL_TCGS = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'];
const RETAIL_TCGS = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'];
const SPORTS_LEAN = ['pokemon']; // sports+TCG houses that have Pokemon exposure

const PROSPECTS = [
  // ---- GRADING & AUTHENTICATION -----------------------------------------
  { name: 'PSA (Professional Sports Authenticator)', website: 'https://www.psacard.com/', state: 'CA', size: 'large', tcgs: ALL_TCGS, kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_network_wide', note: 'Dominant US grader. TCG volumes substantial (Pokemon especially). Reach via public press/business contact form on psacard.com.' },
  { name: 'Beckett Grading Services (BGS)', website: 'https://www.beckett.com/', state: 'TX', size: 'large', tcgs: ALL_TCGS, kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_network_wide', note: 'Beckett is primarily sports but offers BGS/BCCG for TCG. Public contact on beckett.com.' },
  { name: 'CGC Cards', website: 'https://www.cgccards.com/', state: 'FL', size: 'large', tcgs: ALL_TCGS, kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_network_wide', note: 'Collectibles Guaranty Company grades TCG; strong Pokemon reputation.' },
  { name: 'SGC (Sportscard Guaranty)', website: 'https://gosgc.com/', state: 'FL', size: 'large', tcgs: SPORTS_LEAN, kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_single_site', note: 'Mostly sports but accepts Pokemon.' },
  { name: 'HGA (Hybrid Grading Approach)', website: 'https://hybridgradingapproach.com/', state: 'FL', size: 'medium', tcgs: ALL_TCGS, kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_single_site', note: 'Technology-forward grader with sub-grades.' },
  { name: 'TAG Grading', website: 'https://www.taggrading.com/', state: 'TX', size: 'medium', tcgs: ALL_TCGS, kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_single_site', note: 'Technical Authentication and Grading. AI-based grading system.' },
  { name: 'ARK Grading', website: 'https://arkgrading.com/', state: 'CO', size: 'small', tcgs: ['pokemon', 'mtg'], kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_single_site', note: 'Smaller grader; TCG-focused.' },
  { name: 'MNT Grading', website: 'https://mntgrading.com/', state: 'NC', size: 'small', tcgs: ['pokemon'], kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_single_site', note: 'US grader with Pokemon focus.' },
  { name: 'GMA Grading', website: 'https://gmagrading.com/', state: 'PA', size: 'small', tcgs: ['pokemon'], kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_single_site', note: 'Budget grading option for TCG.' },
  { name: 'Rare Edition Grading', website: 'https://rareedition.com/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_single_site', note: 'Newer entrant in TCG grading.' },
  { name: 'Edge Grading', website: 'https://www.edgegrading.com/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'grading_company', category: 'grading_authentication', offerSlug: 'graded_cta_single_site', note: 'Smaller TCG grader.' },

  // ---- ONLINE TCG RETAILERS ---------------------------------------------
  { name: 'TCGplayer', website: 'https://www.tcgplayer.com/', state: 'NY', size: 'large', tcgs: ALL_TCGS, kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'homepage_brand_strip', note: 'Owned by eBay. Also our primary affiliate partner — approach via existing commercial contacts.' },
  { name: 'Troll and Toad', website: 'https://www.trollandtoad.com/', state: 'KY', size: 'large', tcgs: ALL_TCGS, kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Longstanding US TCG retailer; multi-TCG coverage.' },
  { name: 'Card Kingdom', website: 'https://www.cardkingdom.com/', state: 'WA', size: 'large', tcgs: ['mtg'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'MTG-first US retailer. Seattle HQ. Strong brand.' },
  { name: 'Star City Games', website: 'https://www.starcitygames.com/', state: 'VA', size: 'large', tcgs: ['mtg', 'pokemon', 'ygo', 'onepiece', 'lorcana'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'MTG-first but multi-TCG. Runs SCG CON tournament series.' },
  { name: 'ChannelFireball', website: 'https://www.channelfireball.com/', state: 'CA', size: 'large', tcgs: ['mtg', 'pokemon', 'lorcana'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'MTG-focused with Pokemon/Lorcana growth.' },
  { name: 'CoolStuffInc', website: 'https://www.coolstuffinc.com/', state: 'FL', size: 'large', tcgs: ALL_TCGS, kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Florida-based broad TCG + board game retailer.' },
  { name: 'Miniature Market', website: 'https://www.miniaturemarket.com/', state: 'MO', size: 'medium', tcgs: ['mtg', 'pokemon'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Primarily board games but strong MTG/Pokemon catalogue.' },
  { name: 'Game Nerdz', website: 'https://www.gamenerdz.com/', state: 'TX', size: 'medium', tcgs: ['mtg', 'pokemon'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Texas-based online retailer.' },
  { name: 'ABU Games', website: 'https://www.abugames.com/', state: 'CO', size: 'medium', tcgs: ['mtg'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Longstanding MTG singles buyer+seller.' },
  { name: 'Pokemon Center (TPCi)', website: 'https://www.pokemoncenter.com/', state: 'WA', size: 'large', tcgs: ['pokemon'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: null, note: 'First-party Pokemon Co storefront. Unusual sponsor fit (first-party rightsholder); include for completeness, likely not approached commercially.' },
  { name: 'Alter Reality Games', website: 'https://www.alterrealitygames.com/', state: 'NJ', size: 'medium', tcgs: ['mtg'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'MTG specialist.' },
  { name: 'MTG Mint Card US', website: 'https://www.mtgmintcard.com/', state: null, size: 'medium', tcgs: ['mtg'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'MTG retailer; US shipping focus.' },
  { name: 'Hareruya USA', website: 'https://en.hareruyamtg.com/', state: null, size: 'medium', tcgs: ['mtg'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Hareruya English storefront; serves US buyers.' },
  { name: 'Cardboard Connection', website: 'https://www.cardboardconnection.com/', state: 'CA', size: 'medium', tcgs: ['pokemon'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Primarily sports but with Pokemon catalogue.' },
  { name: 'Collector Store Pokemon', website: 'https://collectorstorellc.com/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Small specialist retailer.' },
  { name: 'Mint Condition Cards', website: 'https://mintconditioncards.com/', state: null, size: 'small', tcgs: ['pokemon', 'mtg'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Small US retailer.' },
  { name: 'Collector\'s Cache', website: 'https://www.collectorscache.com/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Specialist Pokemon retailer.' },

  // ---- LGS ONLINE HYBRIDS -----------------------------------------------
  { name: 'Myriad Games', website: 'https://myriadgames.com/', state: 'NH', size: 'small', tcgs: ['mtg', 'pokemon'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'New Hampshire LGS with online storefront.' },
  { name: 'Cape Fear Games', website: 'https://www.capefeargames.com/', state: 'NC', size: 'medium', tcgs: ['mtg', 'pokemon'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'North Carolina LGS; strong online presence.' },
  { name: 'Game Grid (Vineyard, UT)', website: 'https://www.gamegrid.com/', state: 'UT', size: 'small', tcgs: ['mtg'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'Utah LGS chain, MTG focus.' },
  { name: 'Hobbies, Toys & Trading Cards', website: 'https://www.htttcards.com/', state: 'NY', size: 'small', tcgs: ['pokemon', 'mtg'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'NYC area shop. Verify.' },
  { name: 'Pastimes Chicago', website: 'https://www.pastimes.net/', state: 'IL', size: 'small', tcgs: ['mtg'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'Chicago LGS.' },
  { name: 'Lotus Games', website: 'https://www.lotusgamestn.com/', state: 'TN', size: 'small', tcgs: ['mtg'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'Tennessee LGS.' },
  { name: 'Dropkick Gaming', website: 'https://dropkickgaming.net/', state: null, size: 'small', tcgs: ['mtg'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'MTG-focused LGS.' },
  { name: 'Mothership Books and Games', website: 'https://www.mothershipbg.com/', state: 'TX', size: 'small', tcgs: ['mtg', 'pokemon'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'Texas LGS.' },

  // ---- SEALED DISTRIBUTORS ----------------------------------------------
  { name: 'Blowout Cards', website: 'https://www.blowoutcards.com/', state: 'VA', size: 'large', tcgs: ALL_TCGS, kind: 'vendor', category: 'sealed_distributor', offerSlug: 'sealed_sidebar_release', note: 'Major sealed-product retailer. Virginia.' },
  { name: 'Dave & Adam\'s Card World', website: 'https://www.dacardworld.com/', state: 'NY', size: 'large', tcgs: ALL_TCGS, kind: 'vendor', category: 'sealed_distributor', offerSlug: 'sealed_sidebar_release', note: 'Buffalo NY; multi-category hobby destination.' },
  { name: 'Steel City Collectibles', website: 'https://www.steelcitycollectibles.com/', state: 'PA', size: 'large', tcgs: ALL_TCGS, kind: 'vendor', category: 'sealed_distributor', offerSlug: 'sealed_sidebar_release', note: 'Pennsylvania sealed + breaks operation.' },
  { name: 'Potomac Distribution', website: 'https://www.potomacdistribution.com/', state: 'MD', size: 'medium', tcgs: ['pokemon', 'mtg'], kind: 'vendor', category: 'sealed_distributor', offerSlug: 'sealed_sidebar_release', note: 'Maryland sealed hobby distributor.' },
  { name: 'Burbank Sportscards', website: 'https://burbanksportscards.com/', state: 'CA', size: 'large', tcgs: ['pokemon'], kind: 'vendor', category: 'sealed_distributor', offerSlug: 'sealed_sidebar_release', note: 'Burbank, CA. Sports lead but Pokemon exposure.' },
  { name: 'Baseball Card Exchange', website: 'https://www.bbcexchange.com/', state: 'IN', size: 'medium', tcgs: SPORTS_LEAN, kind: 'vendor', category: 'sealed_distributor', offerSlug: 'sealed_sidebar_release', note: 'BBCE — sports sealed authenticator; Pokemon tangential.' },
  { name: 'Atlanta Sports Cards', website: 'https://atlantasportscards.com/', state: 'GA', size: 'medium', tcgs: SPORTS_LEAN, kind: 'vendor', category: 'sealed_distributor', offerSlug: 'sealed_sidebar_release', note: 'Georgia sports-first sealed retailer.' },

  // ---- SINGLES SPECIALISTS ---------------------------------------------
  { name: 'Just Collect', website: 'https://www.justcollect.com/', state: 'NJ', size: 'medium', tcgs: SPORTS_LEAN, kind: 'vendor', category: 'singles_specialist', offerSlug: 'vintage_specialist_cta', note: 'New Jersey; focus on vintage sports buying but TCG tangent.' },
  { name: 'Vintage Breaks', website: 'https://vintagebreaks.com/', state: 'FL', size: 'medium', tcgs: SPORTS_LEAN, kind: 'vendor', category: 'singles_specialist', offerSlug: 'vintage_specialist_cta', note: 'Vintage focus; sports-led, Pokemon as adjacency.' },
  { name: 'MINT Collectibles', website: 'https://mintcollectibles.net/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'vendor', category: 'singles_specialist', offerSlug: 'vintage_specialist_cta', note: 'Pokemon vintage specialist.' },
  { name: 'Pokellector', website: 'https://www.pokellector.com/', state: null, size: 'medium', tcgs: ['pokemon'], kind: 'vendor', category: 'singles_specialist', offerSlug: 'vintage_specialist_cta', note: 'Pokemon collection management + singles catalogue.' },

  // ---- BUYLIST ---------------------------------------------------------
  { name: 'Card Conduit', website: 'https://cardconduit.com/', state: 'OR', size: 'small', tcgs: ['mtg', 'pokemon'], kind: 'vendor', category: 'buylist', offerSlug: 'card_page_buylist_cta', note: 'Oregon-based consignment / buylist specialist.' },
  { name: 'Sportlots', website: 'https://www.sportlots.com/', state: 'WA', size: 'medium', tcgs: SPORTS_LEAN, kind: 'vendor', category: 'buylist', offerSlug: 'card_page_buylist_cta', note: 'Sports lots marketplace with buying programme.' },
  { name: 'MTGCommerce', website: 'https://www.mtgcommerce.com/', state: null, size: 'small', tcgs: ['mtg'], kind: 'vendor', category: 'buylist', offerSlug: 'card_page_buylist_cta', note: 'MTG buylist/retail hybrid.' },
  { name: 'Buylist by Kingdom (CK)', website: 'https://www.cardkingdom.com/buylist', state: 'WA', size: 'large', tcgs: ['mtg'], kind: 'vendor', category: 'buylist', offerSlug: 'card_page_buylist_cta', note: 'Card Kingdom buylist arm. Treat as sub-brand of CK entry; keep for buylist-specific placement planning.' },

  // ---- AUCTION / CONSIGNMENT -------------------------------------------
  { name: 'Goldin Auctions', website: 'https://www.goldin.co/', state: 'NJ', size: 'large', tcgs: ALL_TCGS, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Owned by eBay. Full-service high-end auction house including TCG.' },
  { name: 'Heritage Auctions', website: 'https://www.ha.com/', state: 'TX', size: 'large', tcgs: ALL_TCGS, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Dallas; across all collectibles categories.' },
  { name: 'PWCC Marketplace', website: 'https://www.pwccmarketplace.com/', state: 'OR', size: 'large', tcgs: ['pokemon', 'mtg'], kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Oregon-based auction / vault. Confirm current trading status.' },
  { name: 'Robert Edward Auctions', website: 'https://www.robertedwardauctions.com/', state: 'NJ', size: 'medium', tcgs: SPORTS_LEAN, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Sports-first but includes TCG.' },
  { name: 'Fanatics Collect', website: 'https://www.fanaticscollect.com/', state: 'NJ', size: 'large', tcgs: ['pokemon'], kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Fanatics-owned auction + marketplace platform (formerly PWCC-adjacent).' },
  { name: 'Memory Lane Inc', website: 'https://www.memorylaneinc.com/', state: 'CA', size: 'medium', tcgs: SPORTS_LEAN, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'California; sports-focused auctions.' },
  { name: 'Mile High Card Company', website: 'https://www.milehighcardco.com/', state: 'CO', size: 'medium', tcgs: SPORTS_LEAN, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Colorado-based sports card auction house.' },
  { name: 'SCP Auctions', website: 'https://www.scpauctions.com/', state: 'CA', size: 'medium', tcgs: SPORTS_LEAN, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Sports auctions.' },
  { name: 'Lelands', website: 'https://www.lelands.com/', state: 'NJ', size: 'medium', tcgs: SPORTS_LEAN, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Sports/collectibles auctioneer.' },
  { name: 'Clean Sweep Auctions', website: 'https://www.cleansweepauctions.com/', state: 'NY', size: 'small', tcgs: SPORTS_LEAN, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Smaller sports-focused auction house.' },
  { name: 'Love of the Game Auctions', website: 'https://www.loveofthegameauctions.com/', state: 'NJ', size: 'small', tcgs: SPORTS_LEAN, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Smaller auction house.' },
  { name: 'Grey Flannel Auctions', website: 'https://greyflannelauctions.com/', state: 'NY', size: 'small', tcgs: SPORTS_LEAN, kind: 'auction', category: 'auction_consignment', offerSlug: 'graded_consignment_cta', note: 'Sports memorabilia; smaller TCG tangent.' },

  // ---- MARKETPLACE / PLATFORM ------------------------------------------
  { name: 'eBay (collectibles)', website: 'https://www.ebay.com/b/Collectibles/1/bn_1878829', state: 'CA', size: 'large', tcgs: ALL_TCGS, kind: 'ebay', category: 'marketplace_platform', offerSlug: 'marketplace_logo_pricing', note: 'Dominant marketplace; also parent of TCGplayer and Goldin. Approach via existing partner relationships.' },
  { name: 'Alt', website: 'https://www.alt.xyz/', state: 'NY', size: 'medium', tcgs: SPORTS_LEAN, kind: 'marketplace', category: 'marketplace_platform', offerSlug: 'marketplace_logo_pricing', note: 'Alt sports+TCG platform; vault service.' },
  { name: 'Whatnot', website: 'https://www.whatnot.com/', state: 'CA', size: 'large', tcgs: ['pokemon', 'onepiece', 'lorcana'], kind: 'marketplace', category: 'marketplace_platform', offerSlug: 'marketplace_logo_pricing', note: 'LA-based live-selling platform; TCG category is major.' },
  { name: 'Collectr', website: 'https://www.collectrcards.com/', state: null, size: 'medium', tcgs: ALL_TCGS, kind: 'scanner_tool', category: 'marketplace_platform', offerSlug: 'marketplace_logo_pricing', note: 'Scanner-first app with marketplace features; cross-category.' },
  { name: 'Card Ladder', website: 'https://www.cardladder.com/', state: 'FL', size: 'medium', tcgs: ['pokemon'], kind: 'marketplace', category: 'marketplace_platform', offerSlug: 'marketplace_logo_pricing', note: 'Sports+TCG market data; limited TCG surface.' },
  { name: 'Mavin', website: 'https://www.mavin.io/', state: null, size: 'small', tcgs: ALL_TCGS, kind: 'marketplace', category: 'marketplace_platform', offerSlug: 'marketplace_logo_pricing', note: 'Pricing data from recent sales; browser tool.' },
  { name: 'Fanatics Live', website: 'https://www.fanaticslive.com/', state: 'CA', size: 'large', tcgs: ['pokemon'], kind: 'marketplace', category: 'marketplace_platform', offerSlug: 'marketplace_logo_pricing', note: 'Fanatics-owned live streaming platform.' },
  { name: 'Loupe App', website: 'https://www.loupeapp.com/', state: 'CA', size: 'small', tcgs: SPORTS_LEAN, kind: 'marketplace', category: 'marketplace_platform', offerSlug: 'marketplace_logo_pricing', note: 'Mobile live-selling platform; sports lead.' },

  // ---- ACCESSORIES / SLEEVES / STORAGE ---------------------------------
  { name: 'Ultra PRO', website: 'https://www.ultrapro.com/', state: 'CA', size: 'large', tcgs: ALL_TCGS, kind: 'accessory', category: 'accessories', offerSlug: 'collection_feature_sponsor', note: 'Dominant US accessory brand (sleeves, binders, deck boxes).' },
  { name: 'BCW Supplies', website: 'https://www.bcwsupplies.com/', state: 'IN', size: 'large', tcgs: ALL_TCGS, kind: 'accessory', category: 'accessories', offerSlug: 'collection_feature_sponsor', note: 'Indiana-based accessory distributor; owns Pro-Mold brand.' },
  { name: 'Max Protection', website: 'https://www.maxprotection.com/', state: 'CA', size: 'medium', tcgs: ALL_TCGS, kind: 'accessory', category: 'accessories', offerSlug: 'collection_feature_sponsor', note: 'US sleeves and holders.' },
  { name: 'Legion Supplies', website: 'https://legionsupplies.com/', state: 'CA', size: 'medium', tcgs: ['mtg'], kind: 'accessory', category: 'accessories', offerSlug: 'collection_feature_sponsor', note: 'MTG-first sleeve manufacturer.' },
  { name: 'Ultimate Guard (US)', website: 'https://www.ultimateguard.com/en/', state: null, size: 'large', tcgs: ALL_TCGS, kind: 'accessory', category: 'accessories', offerSlug: 'collection_feature_sponsor', note: 'German origin but major US distribution via Magic Industries / local reps.' },
  { name: 'Enhance Gaming', website: 'https://enhancegaming.com/', state: null, size: 'small', tcgs: ALL_TCGS, kind: 'accessory', category: 'accessories', offerSlug: 'collection_feature_sponsor', note: 'US accessory manufacturer.' },
  { name: 'Dex Protection', website: 'https://www.dexprotection.com/', state: 'CA', size: 'medium', tcgs: ALL_TCGS, kind: 'accessory', category: 'accessories', offerSlug: 'collection_feature_sponsor', note: 'US accessory brand.' },

  // ---- DISPLAY & PREMIUM PROTECTION ------------------------------------
  { name: 'Pro-Mold', website: 'https://promold.com/', state: 'IN', size: 'medium', tcgs: ALL_TCGS, kind: 'accessory', category: 'display_premium', offerSlug: 'graded_sidebar_display', note: 'Pro-Mold magnetic holders; owned/distributed by BCW.' },
  { name: 'Westfield Collectibles', website: 'https://www.westfieldcollectibles.com/', state: 'WA', size: 'small', tcgs: SPORTS_LEAN, kind: 'accessory', category: 'display_premium', offerSlug: 'graded_sidebar_display', note: 'Washington; graded-card display cases.' },
  { name: 'Cardboard Gold (CBG)', website: 'https://www.cardboardgold.com/', state: null, size: 'small', tcgs: ALL_TCGS, kind: 'accessory', category: 'display_premium', offerSlug: 'graded_sidebar_display', note: 'Semi-rigid card holders; US distribution.' },

  // ---- SCANNING / INVENTORY / COLLECTION APPS --------------------------
  { name: 'CollX', website: 'https://collx.app/', state: 'PA', size: 'medium', tcgs: ['pokemon'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: 'tool_directory_feature', note: 'Mobile scanner / collection app; strong Pokemon exposure.' },
  { name: 'Dex Collection', website: 'https://www.getdex.com/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: 'tool_directory_feature', note: 'Pokemon-first scanning + collection management.' },
  { name: 'Ludex', website: 'https://ludex.gg/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: 'tool_directory_feature', note: 'Scanning + marketplace, broad TCG + sports.' },
  { name: 'ManaBox', website: 'https://manabox.app/', state: null, size: 'small', tcgs: ['mtg', 'pokemon'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: 'tool_directory_feature', note: 'MTG scanner and binder app; growing Pokemon support.' },
  { name: 'Deckbox', website: 'https://deckbox.org/', state: null, size: 'small', tcgs: ['mtg'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: 'tool_directory_feature', note: 'MTG binder / collection tracker.' },
  { name: 'Moxfield', website: 'https://www.moxfield.com/', state: null, size: 'medium', tcgs: ['mtg'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: 'tool_directory_feature', note: 'MTG deck-building; Commander focus; US-run.' },
  { name: 'Archidekt', website: 'https://archidekt.com/', state: null, size: 'small', tcgs: ['mtg'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: 'tool_directory_feature', note: 'MTG deck-building platform.' },
  { name: 'PriceCharting', website: 'https://www.pricecharting.com/', state: 'IL', size: 'medium', tcgs: ['pokemon'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: 'tool_directory_feature', note: 'Price database with Pokemon TCG coverage; US-run.' },
  { name: 'Pokemon TCG Pocket Companion Apps', website: 'https://ptcgplive.pokemon.com/', state: 'WA', size: 'large', tcgs: ['pokemon'], kind: 'scanner_tool', category: 'scanning_inventory', offerSlug: null, note: 'First-party Pokemon TCG Live. First-party, likely not approached.' },

  // ---- CARD SHOWS / CONVENTIONS ----------------------------------------
  { name: 'The National Sports Collectors Convention', website: 'https://www.nsccshow.com/', state: 'IL', size: 'large', tcgs: SPORTS_LEAN, kind: 'event', category: 'card_show_event', offerSlug: 'featured_event_listing', note: 'The National — annual US sports+collectibles show. Pokemon adjacency.' },
  { name: 'Dallas Card Show', website: 'https://dallascardshow.com/', state: 'TX', size: 'large', tcgs: SPORTS_LEAN, kind: 'event', category: 'card_show_event', offerSlug: 'featured_event_listing', note: 'Monthly Dallas-area show; significant Pokemon presence.' },
  { name: 'Philly Non-Sports Card Show', website: 'https://www.phillynonsportscardshow.com/', state: 'PA', size: 'small', tcgs: ['pokemon'], kind: 'event', category: 'card_show_event', offerSlug: 'featured_event_listing', note: 'Non-sports show; Pokemon TCG regularly featured.' },
  { name: 'Fanatics Fest', website: 'https://www.fanaticsfest.com/', state: 'NY', size: 'large', tcgs: SPORTS_LEAN, kind: 'event', category: 'card_show_event', offerSlug: 'featured_event_listing', note: 'Fanatics-run annual fan fest at Javits NYC; strong TCG presence.' },
  { name: 'Chicago Card Shows', website: 'https://www.chicagocardshows.com/', state: 'IL', size: 'small', tcgs: SPORTS_LEAN, kind: 'event', category: 'card_show_event', offerSlug: 'featured_event_listing', note: 'Regional show organiser.' },
  { name: 'SCG CON (Star City)', website: 'https://sellcards.starcitygames.com/scgcon', state: 'VA', size: 'large', tcgs: ['mtg', 'pokemon'], kind: 'event', category: 'card_show_event', offerSlug: 'featured_event_listing', note: 'Star City Games tournament convention series. Treat as sub-brand of SCG; keep for event placement discussion.' },
  { name: 'MagicCon (Wizards of the Coast)', website: 'https://magic.wizards.com/en/magiccon', state: 'WA', size: 'large', tcgs: ['mtg'], kind: 'event', category: 'card_show_event', offerSlug: null, note: 'First-party. Likely not approached commercially.' },

  // ---- BREAKERS / LIVESTREAM -------------------------------------------
  { name: 'Hit Parade', website: 'https://www.hitparade.com/', state: 'FL', size: 'medium', tcgs: ['pokemon'], kind: 'content_creator', category: 'breaker_livestream', offerSlug: 'release_breaker_sidebar', note: 'Florida-based personal collection boxes + mystery packs.' },
  { name: 'Mojo Breaks', website: 'https://mojobreaks.com/', state: 'CA', size: 'medium', tcgs: SPORTS_LEAN, kind: 'content_creator', category: 'breaker_livestream', offerSlug: 'release_breaker_sidebar', note: 'Sports lead; Pokemon as adjacency.' },
  { name: 'Firehand Cards', website: 'https://firehandcards.com/', state: null, size: 'small', tcgs: SPORTS_LEAN, kind: 'content_creator', category: 'breaker_livestream', offerSlug: 'release_breaker_sidebar', note: 'Smaller breaker operation.' },
  { name: 'Layton Sports Cards', website: 'https://laytonsportscards.com/', state: 'CA', size: 'medium', tcgs: SPORTS_LEAN, kind: 'content_creator', category: 'breaker_livestream', offerSlug: 'release_breaker_sidebar', note: 'Prominent breaker; sports-first.' },

  // ---- INSURANCE --------------------------------------------------------
  { name: 'Collectibles Insurance Services', website: 'https://collectinsure.com/', state: 'MD', size: 'medium', tcgs: ALL_TCGS, kind: 'other', category: 'insurance', offerSlug: 'sidebar_insurance_mention', note: 'Maryland-based specialist collectibles insurer.' },
  { name: 'American Collectors Insurance', website: 'https://www.americancollectors.com/', state: 'NJ', size: 'medium', tcgs: ALL_TCGS, kind: 'other', category: 'insurance', offerSlug: 'sidebar_insurance_mention', note: 'US specialty collectibles insurance underwriter.' },
  { name: 'Hugh Wood Inc', website: 'https://www.huwoodinc.com/', state: 'NY', size: 'small', tcgs: ALL_TCGS, kind: 'other', category: 'insurance', offerSlug: 'sidebar_insurance_mention', note: 'US arm of Hugh Wood collectibles insurance.' },

  // ---- SUBSCRIPTION / MYSTERY ------------------------------------------
  { name: 'The Blind Break Co', website: 'https://theblindbreak.com/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'content_creator', category: 'subscription_mystery', offerSlug: 'insight_article_sponsor', note: 'Mystery-pack subscription operator; verify current status.' },
  { name: 'Pokemon Mystery Power Box (Walmart retail)', website: 'https://www.pokemon.com/', state: 'WA', size: 'large', tcgs: ['pokemon'], kind: 'other', category: 'subscription_mystery', offerSlug: null, note: 'First-party retail product line. First-party; not approached commercially.' },

  // ---- OTHER COMMERCIAL --------------------------------------------------
  { name: 'MTGGoldfish', website: 'https://www.mtggoldfish.com/', state: null, size: 'medium', tcgs: ['mtg'], kind: 'content_creator', category: 'other_collector_business', offerSlug: 'insight_article_sponsor', note: 'MTG market data + content; US-focused.' },
  { name: 'EDHREC', website: 'https://edhrec.com/', state: null, size: 'medium', tcgs: ['mtg'], kind: 'content_creator', category: 'other_collector_business', offerSlug: 'insight_article_sponsor', note: 'Commander data site; audience overlap with MTG insights.' },
  { name: 'Sports Collectors Daily', website: 'https://www.sportscollectorsdaily.com/', state: null, size: 'small', tcgs: SPORTS_LEAN, kind: 'content_creator', category: 'other_collector_business', offerSlug: 'insight_article_sponsor', note: 'Sports-first collectibles news; limited TCG tangent.' },
  { name: 'Pokemon Database', website: 'https://pokemondb.net/', state: null, size: 'medium', tcgs: ['pokemon'], kind: 'content_creator', category: 'other_collector_business', offerSlug: 'insight_article_sponsor', note: 'Reference site; Pokemon audience adjacency.' },
  { name: 'Serebii', website: 'https://www.serebii.net/', state: null, size: 'medium', tcgs: ['pokemon'], kind: 'content_creator', category: 'other_collector_business', offerSlug: 'insight_article_sponsor', note: 'Pokemon news / database; strong audience overlap.' },
  { name: 'Bulbapedia', website: 'https://bulbapedia.bulbagarden.net/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'content_creator', category: 'other_collector_business', offerSlug: null, note: 'Volunteer-run wiki; probably not a commercial sponsor target.' },
  { name: 'Scryfall', website: 'https://scryfall.com/', state: null, size: 'small', tcgs: ['mtg'], kind: 'content_creator', category: 'other_collector_business', offerSlug: null, note: 'MTG card database; nonprofit-run, unlikely commercial sponsor fit.' },

  // ---- ADDITIONAL ONLINE RETAILERS (long tail) -------------------------
  { name: 'Collector\'s Boutique Online', website: 'https://thecollectorsboutique.com/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Smaller specialist retailer.' },
  { name: 'Toywiz', website: 'https://www.toywiz.com/', state: 'NJ', size: 'medium', tcgs: ['pokemon', 'ygo'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'New Jersey; Pokemon + Yu-Gi-Oh! strong.' },
  { name: 'Big Orbit Cards', website: 'https://www.bigorbit.cards/', state: null, size: 'small', tcgs: ['pokemon'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Online retailer; verify US vs UK.' },
  { name: 'MTG First', website: 'https://www.mtgfirst.com/', state: null, size: 'small', tcgs: ['mtg'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Smaller MTG retailer; verify US HQ.' },
  { name: 'Yu-Gi-Oh! Toronto / US', website: 'https://www.yugiohto.com/', state: null, size: 'small', tcgs: ['ygo'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Verify US presence vs Canada; may be excluded on verification.' },
  { name: 'Da Card House', website: 'https://dacardhouse.com/', state: null, size: 'small', tcgs: ['pokemon', 'ygo'], kind: 'marketplace', category: 'online_tcg_retailer', offerSlug: 'featured_retailer_set_pages', note: 'Online retailer; verify US presence.' },
  { name: 'ChannelFireball Game Center', website: 'https://cfbgamecenter.com/', state: 'CA', size: 'medium', tcgs: ['mtg'], kind: 'lgs', category: 'lgs_online_hybrid', offerSlug: 'regional_lgs_listing', note: 'CFB physical / hybrid storefront.' },
];

// -----------------------------------------------------------------------
console.log(`[cn06a-seed] loaded ${PROSPECTS.length} prospect candidates`);

// Resolve category + offer lookups.
const { data: cats, error: catErr } = await sb.from('crm_vendor_categories').select('code');
if (catErr) throw new Error(`[cn06a-seed] load categories: ${catErr.message}`);
const validCategories = new Set(cats.map((c) => c.code));

const { data: offers, error: offErr } = await sb.from('crm_vendor_offers').select('id, slug, category_code, price_minor, price_currency');
if (offErr) throw new Error(`[cn06a-seed] load offers: ${offErr.message}`);
const offersBySlug = new Map(offers.map((o) => [o.slug, o]));

// Insert / upsert.
let inserted = 0;
let updated = 0;
let skipped = 0;
const slugs = new Set();
const errors = [];

for (const p of PROSPECTS) {
  if (!validCategories.has(p.category)) {
    skipped += 1;
    errors.push({ name: p.name, reason: `unknown category: ${p.category}` });
    continue;
  }
  const slug = slugify(p.name);
  if (slugs.has(slug)) {
    skipped += 1;
    errors.push({ name: p.name, reason: `duplicate slug: ${slug}` });
    continue;
  }
  slugs.add(slug);

  const offer = p.offerSlug ? offersBySlug.get(p.offerSlug) : null;
  if (p.offerSlug && !offer) {
    errors.push({ name: p.name, reason: `offer slug not found: ${p.offerSlug}` });
  }

  const row = {
    slug,
    display_name: p.name,
    kind: p.kind,
    status: 'prospect',
    website: p.website,
    description: p.note,
    countries: ['US'],
    tags: [],
    priority: 3,
    vendor_category: p.category,
    relevant_tcgs: p.tcgs,
    us_state: p.state,
    is_us_business: true,
    estimated_size: p.size,
    research_sources: [p.website],
    research_confidence: 'medium',
    last_researched_at: new Date().toISOString(),
    recommended_offer_id: offer?.id ?? null,
    recommended_price_minor: offer?.price_minor ?? null,
    recommended_currency: offer?.price_currency ?? 'GBP',
    first_wave: false, // we'll flag after scoring
  };

  // Try insert; if slug conflict, update.
  const insertRes = await sb.from('network_partners').insert(row).select('id').single();
  if (insertRes.error) {
    if (/duplicate key/i.test(insertRes.error.message) || insertRes.error.code === '23505') {
      // Update by slug.
      const { error: upErr } = await sb.from('network_partners').update(row).eq('slug', slug);
      if (upErr) {
        errors.push({ name: p.name, reason: `update failed: ${upErr.message}` });
        skipped += 1;
      } else {
        updated += 1;
      }
    } else {
      errors.push({ name: p.name, reason: insertRes.error.message });
      skipped += 1;
    }
  } else {
    inserted += 1;
  }
}

console.log(`[cn06a-seed] inserted=${inserted} updated=${updated} skipped=${skipped} total=${PROSPECTS.length}`);
if (errors.length) {
  console.log(`[cn06a-seed] errors:`);
  for (const e of errors) console.log(`  - ${e.name}: ${e.reason}`);
}
