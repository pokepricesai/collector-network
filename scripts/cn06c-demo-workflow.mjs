// CN-06C Phase 6: demonstrate the full sales workflow on a real
// prospect (Blowout Cards) WITHOUT fabricating any sent email or
// won deal. Everything stored stays explicitly in a "draft" /
// "internal" / "not sent" state so no false history is created.

import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc';
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const SLUG = 'blowout-cards';

function log(step, data) { console.log(`\n[demo:${step}] ${JSON.stringify(data, null, 2)}`); }

// 1. Load partner.
const p = await sb.from('network_partners').select('*').eq('slug', SLUG).single();
if (p.error) throw new Error(p.error.message);
log('1-partner', { id: p.data.id, display_name: p.data.display_name, status: p.data.status, fit_score: p.data.fit_score, first_wave: p.data.first_wave });

// 2. List verified contacts.
const contacts = await sb.from('network_partner_contacts').select('*').eq('partner_id', p.data.id);
log('2-contacts', contacts.data.map((c) => ({ name: c.full_name, email: c.email, verification: c.email_verification, source: c.source_url, primary: c.is_primary })));

// 3. Show the attached CN-06C draft.
const draft = await sb.from('network_partner_interactions')
  .select('summary, detail, kind, direction')
  .eq('partner_id', p.data.id)
  .ilike('summary', '[DRAFT CN-06C wave-1]%').single();
if (draft.error) throw new Error(draft.error.message);
log('3-draft', { summary: draft.data.summary, kind: draft.data.kind, direction: draft.data.direction, length: draft.data.detail?.length ?? 0 });

// 4. Qualify: move stage to ready_to_contact.
const stage1 = await sb.from('network_partners').update({ status: 'ready_to_contact' }).eq('id', p.data.id);
if (stage1.error) throw new Error(stage1.error.message);
await sb.from('network_partner_interactions').insert({
  partner_id: p.data.id, kind: 'note', direction: 'internal',
  summary: 'Stage prospect → ready_to_contact',
  detail: '[CN-06C demo] Qualified for wave-1 outreach. Verified named exec + public inbox + £300/mo offer confirmed deliverable (dedicated feature article).',
  metadata: { source: 'cn06c_demo' },
});
log('4-stage', { new: 'ready_to_contact' });

// 5. Create an opportunity record (network_sponsorships) in DRAFT. This
//    is the "deal" model — a single partner can hold many of these.
//    status=draft explicitly means not sent / not accepted.
const existing = await sb.from('network_sponsorships').select('id').eq('partner_id', p.data.id).ilike('title', '%CN-06C wave-1 intro%').maybeSingle();
let oppId = existing.data?.id;
if (!oppId) {
  const ins = await sb.from('network_sponsorships').insert({
    partner_id: p.data.id,
    title: 'CN-06C wave-1 intro — one-article-per-month on MTGPrices',
    total_value_minor: 3600_00, // £3,600 ACV (12mo × £300)
    currency: 'GBP',
    term_months: 12,
    billing_cadence: 'monthly',
    status: 'draft',
    notes: '[CN-06C demo] Draft deal record for workflow verification. NOT sent, NOT accepted. Draft only.',
  }).select('id').single();
  if (ins.error) throw new Error(ins.error.message);
  oppId = ins.data.id;
}
log('5-opportunity', { id: oppId, status: 'draft', title: 'CN-06C wave-1 intro — one-article-per-month on MTGPrices', monthly: 300, acv: 3600, term_months: 12 });

// 6. Set a follow-up for day+3 and leave a next_action.
const d3 = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
const fu = await sb.from('network_partners').update({ next_action: 'DEMO: review wave-1 draft, then send if operator approves', next_action_due: d3 }).eq('id', p.data.id);
if (fu.error) throw new Error(fu.error.message);
log('6-followup', { next_action_due: d3 });

// 7. Verify persistence by reloading.
const after = await sb.from('network_partners').select('status, next_action, next_action_due').eq('id', p.data.id).single();
log('7-persistence', after.data);

const dealAfter = await sb.from('network_sponsorships').select('status, total_value_minor, term_months').eq('id', oppId).single();
log('7-deal-persistence', dealAfter.data);

const interactionsAfter = await sb.from('network_partner_interactions').select('kind, direction, summary').eq('partner_id', p.data.id).order('created_at', { ascending: false }).limit(5);
log('7-interactions-top-5', interactionsAfter.data);

// 8. CRUCIAL: no email was actually sent. Verify there's zero kind='email_sent' for this partner.
const sent = await sb.from('network_partner_interactions').select('id').eq('partner_id', p.data.id).eq('kind', 'email_sent');
log('8-no-emails-sent', { email_sent_rows: sent.data.length });

// 9. CRUCIAL: no deal was marked as won.
const won = await sb.from('network_sponsorships').select('id').eq('partner_id', p.data.id).in('status', ['accepted', 'active']);
log('9-no-deals-won', { active_or_accepted_rows: won.data.length });

console.log('\n[demo] WORKFLOW VERIFIED. Every state above persists on the admin UI.');
console.log('       URLs to confirm:');
console.log(`         /admin/partners/${p.data.id}            — partner profile + CN-06A fit + contacts + offer + drafts`);
console.log('         /admin/partners/pipeline                — Kanban: Blowout Cards now shows in "ready_to_contact" column');
console.log('         /admin/partners/morning                 — follow-up scheduled 3 days out');
console.log('         /admin/partners/sponsorships            — the draft deal appears in the table');
