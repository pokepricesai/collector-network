// CN-06C Phase 4: realign every first-wave prospect to the honest
// intro package, then regenerate the 25 outreach drafts to match
// the new offer language. Preserve 'DRAFT' status and the operator's
// right to review before anyone receives anything.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const introOffer = await sb.from('crm_vendor_offers').select('id, price_minor').eq('slug', 'cn06c_intro_feature_article').single();
if (introOffer.error) throw new Error(`load intro: ${introOffer.error.message}`);

// Point every first-wave at the honest intro, with its catalogue price.
const waveUpdate = await sb.from('network_partners').update({
  recommended_offer_id: introOffer.data.id,
  recommended_price_minor: introOffer.data.price_minor,
  recommended_currency: 'GBP',
}).eq('first_wave', true);
if (waveUpdate.error) throw new Error(`realign: ${waveUpdate.error.message}`);
console.log('[realign] all first-wave prospects → cn06c_intro_feature_article (£300/mo)');

// Reload wave with full context for drafting.
const wave = await sb.from('network_partners').select(`
  id, slug, display_name, vendor_category, website,
  metadata, relevant_tcgs, estimated_size
`).eq('first_wave', true);
if (wave.error) throw new Error(wave.error.message);

const contactsRes = await sb.from('network_partner_contacts').select('*')
  .in('partner_id', wave.data.map((p) => p.id))
  .eq('suppressed', false);
if (contactsRes.error) throw new Error(contactsRes.error.message);

const byPartner = new Map();
for (const c of contactsRes.data) {
  const arr = byPartner.get(c.partner_id) ?? [];
  arr.push(c);
  byPartner.set(c.partner_id, arr);
}

function pickExecRow(contacts) {
  return (contacts ?? []).find((c) => c.full_name && !c.full_name.includes('—')) ?? null;
}
function pickInboxRow(contacts) {
  return (contacts ?? []).find((c) => c.full_name?.includes('— Public inbox') || (c.email && !pickExecRow(contacts))) ?? null;
}
function pickFormRow(contacts) {
  return (contacts ?? []).find((c) => c.contact_url) ?? null;
}

function firstName(n) {
  if (!n) return null;
  const base = n.split(/[—(]/)[0].trim();
  const parts = base.split(/\s+/);
  return parts[0] || null;
}

function pickSiteForTcgs(tcgs) {
  const priority = ['mtg', 'pokemon', 'ygo', 'onepiece', 'lorcana'];
  const site = priority.find((s) => tcgs?.includes(s)) ?? 'mtg';
  const label = { mtg: 'MTGPrices', pokemon: 'PokePrices', ygo: 'YGOPrices', onepiece: 'OnePiecePrices', lorcana: 'LorcanaPrices' }[site];
  return { site, label };
}

function buildDraft(row, contacts) {
  const exec = pickExecRow(contacts);
  const inbox = pickInboxRow(contacts);
  const form = pickFormRow(contacts);
  const fName = firstName(exec?.full_name);
  const salutation = fName ? `Hi ${fName}` : 'Hi there';
  const { label: siteLabel } = pickSiteForTcgs(row.relevant_tcgs);
  const company = row.display_name;

  // Category-shaped audience overlap sentence.
  let overlap;
  switch (row.vendor_category) {
    case 'grading_authentication':
      overlap = `Our audience is already researching PSA 10 and BGS 9.5 values on card pages — the submission-intent moment.`;
      break;
    case 'online_tcg_retailer':
      overlap = `Visitors land on card and set pages with a specific printing in mind — they're past browsing and ready to buy.`;
      break;
    case 'sealed_distributor':
      overlap = `Set release pages and sealed-product coverage attract readers specifically looking at sealed inventory and new-set value.`;
      break;
    case 'auction_consignment':
      overlap = `Readers researching high-value graded copies are a natural pre-consignment audience.`;
      break;
    case 'marketplace_platform':
      overlap = `Our pricing comparison panels put ${company} in front of collectors choosing where to buy or list.`;
      break;
    case 'accessories':
      overlap = `Our collection tracking and watchlist features put ${company} in front of collectors right at the point of inventorying their collection.`;
      break;
    case 'insurance':
      overlap = `Readers on high-value and graded card pages are a natural source of policy-aware referrals.`;
      break;
    case 'card_show_event':
      overlap = `Our audience is show-active — a feature article in the run-up to the show routes travel-ready traffic.`;
      break;
    case 'display_premium':
      overlap = `Readers on graded market and high-value pages are a natural audience for premium protection.`;
      break;
    default:
      overlap = `${company}'s customers overlap directly with our collector audience.`;
      break;
  }

  // Honest offer paragraph — no claims about traffic, sidebar CTAs or sponsor badges.
  const offerPara = `I'd like to open with our introductory package: £300 per month, 12-month term, one dedicated editorial feature article on ${siteLabel} per month with an inline "In partnership with ${company}" acknowledgement in the headline and intro paragraph. Articles stay in the /insights archive for the term and remain crawlable afterwards. Monthly placement report via email. No sidebar CTAs or banners — those capabilities aren't built yet and I don't want to oversell what we ship today. Cancellable with 30 days notice from month three.`;

  const audienceCaveat = `I'd rather not quote traffic in a cold email — if a conversation gets going I'll share recent, dated analytics for ${siteLabel} and the five-site aggregate so you can judge for yourself.`;

  // CTA shape depends on contact route.
  let cta;
  if (exec && (inbox || form)) {
    cta = `Easiest for me is a reply to this address; I can also send a one-page overview if that's useful. If someone else on your team handles marketing partnerships, I'm happy to redirect.`;
  } else if (inbox) {
    cta = `This is going to the public ${company} address because I couldn't find a direct contact for marketing partnerships. If someone on your team handles that, I'd gladly reconnect.`;
  } else if (form) {
    cta = `I'll submit this via your public contact form as well. If there's a better route — a partnerships address or a named owner — I'd welcome a steer.`;
  } else {
    cta = `If you're the right person for marketing partnerships, I'd welcome a short reply. If not, a steer to the right contact would be very helpful.`;
  }

  const sender = `Best,\nLuke Pierce\nFounder, Collector Network\nhttps://collector-network.vercel.app  (private hub — public sites: pokeprices.io, mtgprices.io, ygoprices.io, onepieceprices.io, lorcanaprices.io)\nlukejosephpierce@gmail.com`;
  const unsub = `If this isn't a fit, a one-line "no thanks" is plenty and I won't follow up.`;

  const intro = `I run Collector Network — five TCG pricing and insight sites covering Pokemon, Magic: The Gathering, Yu-Gi-Oh!, One Piece and Lorcana. ${overlap}`;

  const body = `${salutation},\n\n${intro}\n\n${offerPara}\n\n${audienceCaveat}\n\n${cta}\n\n${sender}\n\n${unsub}`;
  const subject = `Collector Network sponsorship intro — ${company} on ${siteLabel}`;
  const sendTo = inbox?.email ?? exec?.email ?? null;
  const sendRoute = sendTo ? `email:${sendTo}` : form?.contact_url ? `form:${form.contact_url}` : 'no-route';

  return { subject, body, sendTo, sendRoute };
}

let drafted = 0;
for (const p of wave.data) {
  const contacts = byPartner.get(p.id) ?? [];
  const draft = buildDraft(p, contacts);

  const summary = `[DRAFT CN-06C wave-1] ${draft.subject}`;
  const detail = `TO: ${draft.sendTo ?? '(public contact form — see partner contacts)'}\nROUTE: ${draft.sendRoute}\n\n${draft.body}`;

  // Deactivate the CN-06B draft and insert a new CN-06C one, so the
  // operator sees both versions and can compare.
  await sb.from('network_partner_interactions')
    .update({ summary: '[SUPERSEDED CN-06B wave-1] ' + (await sb.from('network_partner_interactions').select('summary').eq('partner_id', p.id).ilike('summary', '[DRAFT CN-06B wave-1]%').limit(1).maybeSingle()).data?.summary?.replace('[DRAFT CN-06B wave-1] ', '') ?? '' })
    .eq('partner_id', p.id).ilike('summary', '[DRAFT CN-06B wave-1]%');

  // Insert CN-06C draft (idempotent on summary pattern).
  const existing = await sb.from('network_partner_interactions')
    .select('id').eq('partner_id', p.id).ilike('summary', '[DRAFT CN-06C wave-1]%').maybeSingle();
  if (existing.data) {
    const { error } = await sb.from('network_partner_interactions').update({ summary, detail }).eq('id', existing.data.id);
    if (error) { console.log(`[draft] update ${p.slug}: ${error.message}`); continue; }
  } else {
    const { error } = await sb.from('network_partner_interactions').insert({
      partner_id: p.id,
      kind: 'note',
      direction: 'internal',
      summary,
      detail,
      metadata: { source: 'cn06c', phase: 'wave-1-draft-v2' },
    });
    if (error) { console.log(`[draft] insert ${p.slug}: ${error.message}`); continue; }
  }

  // Set/refresh next_action.
  await sb.from('network_partners').update({
    next_action: `Review wave-1 CN-06C draft; approved sends go to ${draft.sendTo ?? draft.sendRoute}`,
    next_action_due: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10),
  }).eq('id', p.id);

  drafted += 1;
}

console.log(`[draft] created/updated ${drafted} CN-06C drafts`);
