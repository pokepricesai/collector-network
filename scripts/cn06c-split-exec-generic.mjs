// CN-06C Phase 2: split named execs from generic inboxes.
//
// CN-06B stored named decision-makers (CEOs/founders) alongside the
// company's generic address (support@, info@, customerservice@).
// That misrepresents a generic inbox as the exec's direct email.
//
// This script:
//   • Keeps the exec row with name + role + source_url, but clears
//     the email field (we don't actually have the exec's direct email).
//   • Inserts a second contact row representing the public inbox
//     with full_name = "<Company> — Public inbox", email set, no name.
//   • Marks the public-inbox row is_primary=true so outreach defaults
//     to the usable address; the exec row stays visible but non-primary.
//
// Idempotent: if a cn06c-generated public-inbox row already exists
// for a partner, no new row is created.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const GENERIC_PATTERNS = [
  'info@', 'support@', 'customerservice@', 'customer_service@',
  'contact@', 'hello@', 'sales@', 'help@', 'service@', 'press@',
  'media@', 'admin@', 'orders@', 'customerservice', 'buyer@', 'editor@',
];

function isGeneric(email) {
  if (!email) return false;
  const lo = email.toLowerCase();
  return GENERIC_PATTERNS.some((p) => lo.startsWith(p));
}

const { data: suspect, error } = await sb.from('network_partner_contacts')
  .select('id, partner_id, full_name, role_title, email, email_verification, source_url, contact_url, is_primary, notes, network_partners!inner(slug, display_name, website)');
if (error) throw new Error(error.message);

let split = 0;
let skippedAlready = 0;
let noAction = 0;

for (const row of suspect) {
  if (!row.email || !isGeneric(row.email)) { noAction += 1; continue; }
  if (row.full_name?.includes('—')) { noAction += 1; continue; } // Already a public-inbox row.
  const partnerDisplay = row.network_partners?.display_name;

  // Check if a public-inbox row for this partner already exists.
  const inboxCheck = await sb.from('network_partner_contacts')
    .select('id').eq('partner_id', row.partner_id)
    .ilike('full_name', '% — Public inbox').maybeSingle();
  if (inboxCheck.data) {
    // Already split in a prior run. Still clear email on the exec row.
    const upd = await sb.from('network_partner_contacts')
      .update({ email: null, email_verification: null, email_verified_at: null, is_primary: false,
                notes: (row.notes ?? '') + ' [cn06c] Email detached — generic inbox stored separately.' })
      .eq('id', row.id);
    if (upd.error) console.log(`[split] ${row.network_partners?.slug}: ${upd.error.message}`);
    else { skippedAlready += 1; }
    continue;
  }

  // Demote the exec row FIRST so the partial unique index (is_primary where true) is free.
  const demote = await sb.from('network_partner_contacts').update({ is_primary: false }).eq('id', row.id);
  if (demote.error) {
    console.log(`[split] ${row.network_partners?.slug}: demote exec: ${demote.error.message}`);
    continue;
  }

  // Insert the new public-inbox row (becomes primary).
  const inbox = {
    partner_id: row.partner_id,
    full_name: `${partnerDisplay} — Public inbox`,
    role_title: null,
    email: row.email,
    email_verification: row.email_verification,
    email_verified_at: new Date().toISOString(),
    is_primary: true,
    source_url: row.source_url,
    contact_url: row.contact_url,
    notes: `[cn06c] Public inbox split from exec row. Use for cold outreach; direct exec email not publicly listed.`,
  };
  const ins = await sb.from('network_partner_contacts').insert(inbox).select('id').single();
  if (ins.error) {
    console.log(`[split] ${row.network_partners?.slug}: insert inbox: ${ins.error.message}`);
    continue;
  }

  // Demote exec row: clear email, keep name + source + role.
  const upd = await sb.from('network_partner_contacts').update({
    email: null,
    email_verification: null,
    email_verified_at: null,
    is_primary: false,
    notes: (row.notes ?? '') + ' [cn06c] Direct exec email not publicly listed — generic inbox separated to its own row.',
  }).eq('id', row.id);
  if (upd.error) {
    console.log(`[split] ${row.network_partners?.slug}: update exec: ${upd.error.message}`);
    continue;
  }

  split += 1;
  console.log(`[split] ${row.network_partners?.slug.padEnd(40)} ${row.full_name.padEnd(26)}  ${row.email}  →  split`);
}

console.log(`\n[split] split=${split} already=${skippedAlready} unchanged=${noAction}`);
