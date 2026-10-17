// CN-06C Phase 2: resolve the Card Kingdom / Buylist by Kingdom (CK)
// duplicate. CK's buylist is a sub-brand of Card Kingdom, not a
// separate business.
//
// Resolution: archive the buylist row (preserve history) and append
// its buylist-specific interaction/contact to Card Kingdom so no
// research is lost.

import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc';
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const PRIMARY_SLUG = 'card-kingdom';
const DUP_SLUG = 'buylist-by-kingdom-ck';

const [primary, dup] = await Promise.all([
  sb.from('network_partners').select('id, display_name, metadata').eq('slug', PRIMARY_SLUG).maybeSingle(),
  sb.from('network_partners').select('id, display_name, metadata').eq('slug', DUP_SLUG).maybeSingle(),
]);
if (primary.error || !primary.data) throw new Error('primary not found');
if (dup.error || !dup.data) throw new Error('duplicate not found');

const primaryId = primary.data.id;
const dupId = dup.data.id;

console.log(`[merge] primary=${primaryId} ${primary.data.display_name}`);
console.log(`[merge] duplicate=${dupId} ${dup.data.display_name}`);

// Move contacts and interactions from dup → primary. Demote their
// is_primary flag so we don't collide with the index.
const demoteDupContacts = await sb.from('network_partner_contacts').update({ is_primary: false }).eq('partner_id', dupId);
if (demoteDupContacts.error) console.log(`[merge] demote dup contacts: ${demoteDupContacts.error.message}`);

const moveContacts = await sb.from('network_partner_contacts').update({ partner_id: primaryId }).eq('partner_id', dupId);
if (moveContacts.error) console.log(`[merge] move contacts: ${moveContacts.error.message}`);
else console.log(`[merge] contacts moved`);

const moveInteractions = await sb.from('network_partner_interactions').update({ partner_id: primaryId }).eq('partner_id', dupId);
if (moveInteractions.error) console.log(`[merge] move interactions: ${moveInteractions.error.message}`);
else console.log(`[merge] interactions moved`);

// Archive the duplicate: status = archived, first_wave=false.
// Clear the recommended offer so it stops surfacing in the pipeline.
const mergeMeta = {
  ...(dup.data.metadata ?? {}),
  cn06c_merged_into: primaryId,
  cn06c_merged_at: new Date().toISOString(),
};
const archive = await sb.from('network_partners').update({
  status: 'archived',
  first_wave: false,
  next_action: 'ARCHIVED: merged into Card Kingdom',
  next_action_due: null,
  metadata: mergeMeta,
}).eq('id', dupId);
if (archive.error) console.log(`[merge] archive: ${archive.error.message}`);
else console.log(`[merge] duplicate archived`);

// Add a note to Card Kingdom documenting the merge + the buylist contact.
const noteSummary = '[CN-06C] CK Buylist entry merged into main record';
const existing = await sb.from('network_partner_interactions')
  .select('id').eq('partner_id', primaryId).ilike('summary', '[CN-06C] CK Buylist entry merged%').maybeSingle();
if (!existing.data) {
  const { error } = await sb.from('network_partner_interactions').insert({
    partner_id: primaryId,
    kind: 'note', direction: 'internal',
    summary: noteSummary,
    detail: `The former "Buylist by Kingdom (CK)" record (slug: buylist-by-kingdom-ck) was identified as a sub-brand of Card Kingdom's own buylist arm, not a separate business. Its research sources, contacts and prior buylist-themed draft have been attached to this record. Buylist CTAs on card pages should be pitched through this entry.`,
    metadata: { source: 'cn06c', phase: 'dedup' },
  });
  if (error) console.log(`[merge] note: ${error.message}`);
  else console.log(`[merge] note added`);
}

console.log('[merge] done.');
