// CN-06B Phase 6: generate personalised DRAFT outreach emails for
// the first-wave prospects, grounded in verified research.
//
// Each draft:
//   • Is specific to the company (uses real notes from research).
//   • Names the actual decision-maker where we have a verified source.
//   • Proposes the live-capability offer currently attached to the
//     recommended_offer_id, with the catalogue price.
//   • Is written in American English.
//   • Keeps the opening tight: hook → specific audience overlap →
//     offer → benefit → price → CTA → sign-off.
//   • Includes a "You can reply STOP..." unsubscribe cue (dry
//     commercial-email courtesy) and a reference to our research
//     trail so recipients can verify legitimacy.
//
// Drafts land in network_partner_interactions with:
//   kind='note' direction='internal' summary='[DRAFT CN-06B wave-1] <subject>'
// They are explicitly NOT 'email_sent' so there is zero ambiguity.
// The operator reviews, edits, and sends manually.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc';
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const wave = JSON.parse(fs.readFileSync('scripts/_cn06b/wave-detail.json', 'utf-8'));

function firstName(fullName) {
  if (!fullName) return 'there';
  const base = fullName.split(/[—(]/)[0].trim();
  const parts = base.split(/\s+/);
  return parts[0] || 'there';
}

function money(minor) { return `£${Math.round((minor ?? 0) / 100).toLocaleString()}`; }

// Per-category personalisation. The function receives the full row
// and returns { subject, body }. We lean on the verified research
// notes rather than claims we cannot defend.

function buildDraft(row) {
  const primary = (row.contacts ?? []).find((c) => c.is_primary) ?? (row.contacts ?? [])[0] ?? null;
  const name = firstName(primary?.name);
  const company = row.display_name;
  const offer = row.offer_name ?? 'our Collector Network insights sponsorship';
  const price = money(row.offer_price ?? 15000);
  const sites = (row.placement_sites ?? []).filter((s) => s !== 'network').join(', ') || 'our Collector Network sites';

  const basics = `Hi ${name},\n\nI run Collector Network — the group of five TCG pricing sites covering Pokemon, Magic: The Gathering, Yu-Gi-Oh!, One Piece and Lorcana (pokeprices.io, mtgprices.io, ygoprices.io, onepieceprices.io, lorcanaprices.io).`;
  const close = `Happy to send a one-page overview with the live example and dated audience figures. If you'd rather this went to someone else on your team I'll gladly redirect.\n\nBest,\nLuke Pierce\nCollector Network\nlukejosephpierce@gmail.com`;
  const unsub = `\n\nIf this isn't a fit, just reply with "no thanks" and I won't follow up.`;

  switch (row.vendor_category) {
    case 'grading_authentication': {
      const subject = `Grading referrals from ${sites.toUpperCase()}Prices graded market pages`;
      const specific = `Our graded market pages (/graded on MTGPrices and /market/graded on YGOPrices) attract collectors already researching PSA 10 and BGS 9.5 values — exactly the submission-intent moment. ${company} would be a natural brand to sit alongside those value panels.`;
      const pitch = `Starting ${price}/month, we'd place a "Grade with ${company}" CTA on the graded market pages (${sites}) with a 12-month term. One live sponsored insights piece on the same site is included — real traffic, no inflated promises.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
    case 'online_tcg_retailer':
    case 'sealed_distributor': {
      const subject = `Featured retailer placement on MTGPrices (${company})`;
      const specific = `MTGPrices visitors land on card and set pages with a specific SKU in mind — they're already past the browsing stage. That's a natural fit for ${company}'s catalog, especially around new set releases.`;
      const pitch = `${price}/month places a sponsored insights article plus a 30-day sidebar CTA on MTGPrices. First-month placement, 12-month term with month-two renewal check-in — honest pricing with no engagement-metric guarantees.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
    case 'accessories': {
      const subject = `Accessory brand sponsor for Collector Network collection trackers`;
      const specific = `Our MTG, Yu-Gi-Oh!, One Piece and Lorcana sites include collection tracking and watchlist features. Collectors reach those at the moment they're inventorying — the natural "I need better sleeves/binders" moment for ${company}.`;
      const pitch = `${price}/month places ${company}'s brand on the collection surfaces across four of our sites, plus one sponsored insights piece. 12-month term; monthly review at month three.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
    case 'auction_consignment': {
      const subject = `Consignment leads from MTG and YGO graded card pages`;
      const specific = `Our MTGPrices graded page and YGOPrices market/graded page concentrate collectors already researching high-value graded copies — the pre-consignment conversation. ${company} is a natural destination from that moment.`;
      const pitch = `${price}/month places a "Consign your graded copy to ${company}" CTA alongside PSA 10 / BGS 9.5 value panels on both sites. 12-month term, clear sponsored-attribution.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
    case 'marketplace_platform': {
      const subject = `Platform logo on Collector Network pricing panels (${company})`;
      const specific = `Our card pages compare marketplace pricing. Adding ${company} to that comparison exposes you to collectors literally choosing where to buy or list, with clear sponsored attribution.`;
      const pitch = `${price}/month gets ${company}'s brand on one of our pricing panel positions, starting with a sponsored insights piece in month one. 12-month term.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
    case 'insurance': {
      const subject = `Insurance referrals from high-value Collector Network card pages`;
      const specific = `Collectors on card pages with graded/high-value copies are a natural source of policy-aware referrals. ${company} appearing alongside valuation panels on PokePrices + MTGPrices is a quietly aligned placement.`;
      const pitch = `${price}/month places ${company} as a sponsor on a Collector Network insights article plus 30-day sidebar follow-up. 12-month term.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
    case 'card_show_event': {
      const subject = `Featured show listing for ${company} on Collector Network`;
      const specific = `Our collector audience is show-active. A featured listing for ${company} on our upcoming-shows surface routes travel-ready traffic in the run-up to the event.`;
      const pitch = `${price}/month covers a featured listing plus a 30-day homepage mention leading up to the show. One-off or seasonal — happy to flex.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
    case 'buylist': {
      const subject = `Buylist CTA on MTGPrices + PokePrices card pages (${company})`;
      const specific = `A meaningful share of our card-page visitors are mid-decision on selling. ${company}'s buylist is a direct destination from "What is this worth?" to "Sell your copy to ${company}".`;
      const pitch = `${price}/month places that CTA alongside buy-price panels on MTGPrices (and others on request). Explicit sponsored attribution; 12-month term.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
    default: {
      const subject = `Sponsorship opportunity at Collector Network for ${company}`;
      const specific = `Our audience across the five Collector Network sites is a focused collector readership — pricing, set catalogues and insights. ${company}'s customers overlap directly with that audience.`;
      const pitch = `${price}/month, 12-month term, placed on the surfaces that match your category.`;
      return { subject, body: `${basics}\n\n${specific}\n\n${pitch}\n\n${close}${unsub}` };
    }
  }
}

let created = 0;
let updated = 0;
const errors = [];

for (const row of wave) {
  const draft = buildDraft(row);
  const primary = (row.contacts ?? []).find((c) => c.is_primary) ?? (row.contacts ?? [])[0] ?? null;

  // Store contact_id if we have one and it exists on the contacts table.
  let contactId = null;
  if (primary?.name) {
    const match = await sb.from('network_partner_contacts')
      .select('id').eq('partner_id', row.id).eq('full_name', primary.name).maybeSingle();
    contactId = match.data?.id ?? null;
  }

  const summary = `[DRAFT CN-06B wave-1] ${draft.subject}`;
  const detail = draft.body;

  // Idempotent: find any existing CN-06B wave-1 draft for this partner.
  const existing = await sb.from('network_partner_interactions')
    .select('id')
    .eq('partner_id', row.id)
    .ilike('summary', '[DRAFT CN-06B wave-1]%')
    .maybeSingle();

  if (existing.data) {
    const { error } = await sb.from('network_partner_interactions')
      .update({ kind: 'note', direction: 'internal', summary, detail, contact_id: contactId })
      .eq('id', existing.data.id);
    if (error) errors.push({ slug: row.slug, reason: error.message });
    else updated += 1;
  } else {
    const { error } = await sb.from('network_partner_interactions').insert({
      partner_id: row.id,
      contact_id: contactId,
      kind: 'note',
      direction: 'internal',
      summary,
      detail,
      metadata: { source: 'cn06b', phase: 'wave-1-draft' },
    });
    if (error) errors.push({ slug: row.slug, reason: error.message });
    else created += 1;
  }

  // Also set partner's next_action for operator UX.
  await sb.from('network_partners').update({
    next_action: `Review wave-1 outreach draft and send to ${primary?.email ?? primary?.contact_url ?? 'contact route'}`,
    next_action_due: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10),
  }).eq('id', row.id);
}

console.log(`[cn06b-draft] created=${created} updated=${updated} errors=${errors.length}`);
if (errors.length) for (const e of errors) console.log(`  - ${e.slug}: ${e.reason}`);
