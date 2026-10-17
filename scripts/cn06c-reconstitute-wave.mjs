// CN-06C Phase 2: reconstitute the first wave to be the 25 most
// commercially closable prospects, with enterprise targets explicitly
// moved to an "enterprise_shortlist" tag rather than the wave itself.
//
//   • Archived CK duplicate is skipped automatically (status=archived).
//   • Named decision-maker + usable public inbox gets closability-priority.
//   • Enterprise (ebay-collectibles, fanatics-live, fanatics-collect,
//     heritage-auctions, tcgplayer) is tagged 'enterprise_shortlist'
//     and REMOVED from first_wave. These are longer-cycle deals that
//     should be worked separately, not racing a £300 close.
//   • If removing enterprise reduces the wave below 25, we backfill
//     from the next best closability-scored prospects.

import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc';
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const ENTERPRISE_SLUGS = new Set([
  'ebay-collectibles',
  'fanatics-live',
  'fanatics-collect',
  'heritage-auctions',   // very large enterprise; add to shortlist
  'tcgplayer',           // eBay-owned enterprise
]);

const partners = await sb.from('network_partners')
  .select('id, slug, display_name, vendor_category, fit_score, estimated_size, status, metadata, recommended_offer_id, tags, first_wave')
  .not('vendor_category', 'is', null)
  .neq('status', 'archived');
if (partners.error) throw new Error(partners.error.message);

const contacts = await sb.from('network_partner_contacts')
  .select('partner_id, email, email_verification, contact_url, full_name, suppressed');
if (contacts.error) throw new Error(contacts.error.message);

const offers = await sb.from('crm_vendor_offers')
  .select('id, slug, is_live_capability');
if (offers.error) throw new Error(offers.error.message);
const offerById = new Map(offers.data.map((o) => [o.id, o]));

const sig = new Map();
for (const c of contacts.data) {
  if (c.suppressed) continue;
  const s = sig.get(c.partner_id) ?? { email: false, named: false, route: false, named_email: false, public_inbox: false };
  if (c.email && c.email_verification) {
    s.email = true;
    if (c.full_name?.includes('— Public inbox')) s.public_inbox = true;
    else if (c.full_name && !c.full_name.includes('—')) s.named_email = true;
  }
  if (c.full_name && !c.full_name.includes('—')) s.named = true;
  if (c.contact_url) s.route = true;
  sig.set(c.partner_id, s);
}

function closability(p) {
  const s = sig.get(p.id) ?? { email: false, named: false, route: false, public_inbox: false, named_email: false };
  const meta = p.metadata ?? {};
  const operational = meta.cn06b_operational === 'yes';
  const us = meta.cn06b_us_business === 'yes';
  const poorFit = p.status === 'nurture' || !!meta.cn06b_poor_fit_reason;
  if (!operational || !us || poorFit) return { total: 0, s, exclude: true };

  const offer = p.recommended_offer_id ? offerById.get(p.recommended_offer_id) : null;
  const offerLive = !!offer?.is_live_capability;

  let score = Math.round((p.fit_score ?? 0) * 0.6);

  // Contact route. Public inbox + named exec is BEST (we know who to ask AND have a reachable address).
  if (s.named && s.public_inbox) score += 25;
  else if (s.named_email) score += 25;
  else if (s.email || s.public_inbox) score += 18;
  else if (s.named) score += 10;
  else if (s.route) score += 6;
  else return { total: score, s, exclude: true };

  if (offerLive) score += 10;
  else if (offer) score += 2;

  if (p.estimated_size === 'large') score += 5;
  else if (p.estimated_size === 'medium') score += 3;

  const specialistCats = new Set([
    'online_tcg_retailer', 'lgs_online_hybrid', 'sealed_distributor',
    'singles_specialist', 'buylist', 'accessories', 'scanning_inventory',
    'card_show_event', 'breaker_livestream',
  ]);
  if (specialistCats.has(p.vendor_category)) score += 4;

  // Enterprise penalty — strongly demotes but keeps on the shortlist.
  if (ENTERPRISE_SLUGS.has(p.slug)) score -= 40;

  return { total: Math.max(0, score), s, offerLive, exclude: false };
}

const ranked = partners.data
  .map((p) => ({ p, score: closability(p) }))
  .filter((x) => !x.score.exclude)
  .sort((a, b) => b.score.total - a.score.total);

// Clear existing first_wave + enterprise tag.
await sb.from('network_partners').update({ first_wave: false }).eq('first_wave', true);

// Tag enterprise shortlist (don't put them in wave).
const enterpriseIds = ranked.filter((x) => ENTERPRISE_SLUGS.has(x.p.slug)).map((x) => x.p.id);
for (const id of enterpriseIds) {
  const current = partners.data.find((p) => p.id === id);
  const tags = Array.from(new Set([...(current.tags ?? []), 'enterprise_shortlist']));
  await sb.from('network_partners').update({ tags }).eq('id', id);
}

// Wave 25 excludes enterprise.
const waveCandidates = ranked.filter((x) => !ENTERPRISE_SLUGS.has(x.p.slug)).slice(0, 25);
const waveIds = waveCandidates.map((x) => x.p.id);
if (waveIds.length) {
  const { error } = await sb.from('network_partners').update({ first_wave: true }).in('id', waveIds);
  if (error) throw new Error(error.message);
}

console.log(`[reconstitute] ranked=${ranked.length} enterprise_shortlist=${enterpriseIds.length} wave=${waveIds.length}`);

console.log('\nFIRST WAVE (25) — closability leaders excluding enterprise');
console.log('rk  score  fit  cat                            name                                 signal');
for (const [i, x] of waveCandidates.entries()) {
  const s = x.score.s;
  const sigLabel =
    (s.named && s.public_inbox) ? 'named+inbox' :
    s.named_email ? 'named+email' :
    s.email ? 'inbox-only' :
    s.named ? 'named/no-email' :
    'form-only';
  console.log(`${(i+1).toString().padStart(2)}   ${x.score.total.toString().padStart(3)}  ${(x.p.fit_score ?? 0).toString().padStart(3)}   ${x.p.vendor_category.padEnd(28)} ${x.p.display_name.padEnd(38)} ${sigLabel}`);
}

console.log('\nENTERPRISE SHORTLIST (not in wave)');
for (const x of ranked.filter((x) => ENTERPRISE_SLUGS.has(x.p.slug))) {
  console.log(`     ${x.score.total.toString().padStart(3)}  ${(x.p.fit_score ?? 0).toString().padStart(3)}   ${x.p.vendor_category.padEnd(28)} ${x.p.display_name}`);
}
