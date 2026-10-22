// CN-06B Phase 4: re-rank the first wave on real-world closability.
//
// Preserve the deterministic model fit_score but override first_wave
// using an explicit closability lens:
//
//   • Must be operational, US, not flagged poor_fit.
//   • Must have at least a public contact route (email, named contact,
//     or usable form).
//   • Must have a live-capability recommended offer OR be reachable
//     via one of our 5 live-capability offers.
//   • Prioritise specialist US TCG businesses over mega-brands when
//     the mega-brand lacks a plausible operator-level contact.
//   • Preserve enterprise-strategic targets at the top but demote
//     when a close is unrealistic in a short sales cycle.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

// Pull every CN-06A prospect with contact + offer signals.
const partners = await sb.from('network_partners')
  .select('id, slug, display_name, vendor_category, fit_score, estimated_size, status, metadata, recommended_offer_id')
  .not('vendor_category', 'is', null);
if (partners.error) throw new Error(partners.error.message);

const contacts = await sb.from('network_partner_contacts')
  .select('partner_id, email, email_verification, contact_url, full_name, suppressed');
if (contacts.error) throw new Error(contacts.error.message);

const offers = await sb.from('crm_vendor_offers')
  .select('id, slug, is_live_capability, placement_sites');
if (offers.error) throw new Error(offers.error.message);

const offerById = new Map(offers.data.map((o) => [o.id, o]));

const summary = new Map();
for (const c of contacts.data) {
  if (c.suppressed) continue;
  const s = summary.get(c.partner_id) ?? { email: false, named: false, route: false, named_email: false };
  if (c.email && c.email_verification) s.email = true;
  if (c.full_name && !c.full_name.includes('—')) s.named = true;
  if (c.contact_url) s.route = true;
  if (c.email && c.full_name && !c.full_name.includes('—')) s.named_email = true;
  summary.set(c.partner_id, s);
}

function closabilityScore(p) {
  const s = summary.get(p.id) ?? { email: false, named: false, route: false, named_email: false };
  const meta = p.metadata ?? {};
  const operational = meta.cn06b_operational === 'yes';
  const us = meta.cn06b_us_business === 'yes';
  const poorFit = p.status === 'nurture' || !!meta.cn06b_poor_fit_reason;
  const offer = p.recommended_offer_id ? offerById.get(p.recommended_offer_id) : null;
  const offerLive = !!offer?.is_live_capability;

  if (!operational || !us || poorFit) return { total: 0, s, operational, us, poorFit, offerLive, exclude: true };

  // Base: 60% of CN-06A fit_score (keeps model signal).
  let score = Math.round((p.fit_score ?? 0) * 0.6);

  // Contact route (how reachable is this).
  if (s.named_email) score += 25;
  else if (s.email) score += 18;
  else if (s.named) score += 10;
  else if (s.route) score += 6;
  else return { total: score, s, operational, us, poorFit, offerLive, exclude: true }; // No contact = cannot do a wave.

  // Offer we can actually ship (adds urgency, demotes vaporware).
  if (offerLive) score += 10;
  else if (offer) score += 2;

  // Size → budget signal.
  if (p.estimated_size === 'large') score += 5;
  else if (p.estimated_size === 'medium') score += 3;

  // Specialist TCG focus bonus (over generic mega-brand).
  const specialistCats = new Set([
    'online_tcg_retailer', 'lgs_online_hybrid', 'sealed_distributor',
    'singles_specialist', 'buylist', 'accessories', 'scanning_inventory',
    'card_show_event', 'breaker_livestream',
  ]);
  if (specialistCats.has(p.vendor_category)) score += 4;

  // Mega-brand demotion: enterprise targets where close is slow.
  // We keep them on the strategic list but not in the first wave of
  // closable deals.
  const megaBrandSlugs = new Set([
    'ebay-collectibles',   // enterprise sales track; eBay owns TCGplayer + Goldin
    'fanatics-live',       // enterprise; sports-TV adjacent decisions
    'fanatics-collect',    // enterprise; marketplace team
  ]);
  if (megaBrandSlugs.has(p.slug)) score -= 20;

  return { total: Math.max(0, score), s, operational, us, poorFit, offerLive, exclude: false };
}

const ranked = partners.data
  .map((p) => ({ p, score: closabilityScore(p) }))
  .filter((x) => !x.score.exclude)
  .sort((a, b) => b.score.total - a.score.total);

console.log(`[cn06b-rerank] ${ranked.length} prospects have a usable contact route and are commercially operable.`);

// Clear all first_wave flags, then re-flag top 25.
await sb.from('network_partners').update({ first_wave: false }).eq('first_wave', true);
const top25 = ranked.slice(0, 25);
if (top25.length > 0) {
  const ids = top25.map((x) => x.p.id);
  const { error } = await sb.from('network_partners').update({ first_wave: true }).in('id', ids);
  if (error) throw new Error(error.message);
}

console.log('\n[cn06b-rerank] NEW FIRST WAVE (top 25 by real-world closability):');
console.log('rank  score  model_fit  cat                            name  →  signals');
for (const [i, x] of top25.entries()) {
  const s = x.score.s;
  const sig = [
    s.named_email ? 'named+email' : s.email ? 'email' : s.named ? 'named' : 'form',
    x.score.offerLive ? 'live-offer' : 'build-needed',
  ].join(',');
  console.log(`  ${(i + 1).toString().padStart(2)}   ${x.score.total.toString().padStart(3)}   ${(x.p.fit_score ?? 0).toString().padStart(3)}      ${x.p.vendor_category.padEnd(28)} ${x.p.display_name} → ${sig}`);
}

console.log('\n[cn06b-rerank] STRATEGIC ENTERPRISE SHORTLIST (demoted megas):');
for (const x of ranked.filter((x) => ['ebay-collectibles', 'fanatics-live', 'fanatics-collect', 'tcgplayer'].includes(x.p.slug))) {
  console.log(`      ${x.score.total.toString().padStart(3)}   ${(x.p.fit_score ?? 0).toString().padStart(3)}      ${x.p.vendor_category.padEnd(28)} ${x.p.display_name}`);
}
