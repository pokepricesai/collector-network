// CN-06B: load agent research findings into the CRM.
//
// For each prospect with a findings record:
//   • Verify / correct network_partners fields.
//   • Append confirmed source URLs to research_sources, with
//     verification date in the metadata jsonb.
//   • Create network_partner_contacts rows for:
//       - Publicly listed emails (verification = 'public_listed').
//       - Named decision-makers (email null, name + source populated).
//       - Contact-form routes (contact_url set, email null).
//   • Set research_confidence based on finding quality.
//   • Mark poor_fit prospects with status='nurture' (preserves data).
//
// Guardrails:
//   • Never writes an email that the agent flagged null.
//   • Never writes a named contact without a source URL.
//   • Idempotent — reruns update rather than duplicate.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc';
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const FINDINGS_FILES = [
  'scripts/_cn06b/findings-wave.json',
  'scripts/_cn06b/findings-rest-1.json',
  'scripts/_cn06b/findings-rest-2.json',
  'scripts/_cn06b/findings-rest-3.json',
];

const ALLOWED_CATEGORIES = new Set([
  'grading_authentication','online_tcg_retailer','lgs_online_hybrid',
  'sealed_distributor','singles_specialist','buylist','auction_consignment',
  'marketplace_platform','accessories','display_premium','scanning_inventory',
  'card_show_event','breaker_livestream','insurance','subscription_mystery',
  'other_collector_business',
]);

const today = new Date().toISOString().slice(0, 10);

function parseCategoryChange(val) {
  if (!val) return null;
  if (val === 'yes') return null;
  if (val === 'no') return null;
  const m = /^change_to:\s*(.+)$/.exec(val);
  if (!m) return null;
  const next = m[1].trim();
  return ALLOWED_CATEGORIES.has(next) ? next : null;
}

function emailOk(email) {
  if (!email || typeof email !== 'string') return false;
  // Loose RFC check — reject anything that doesn't look like a real address.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function trim(s) { return typeof s === 'string' ? s.trim() : null; }

let total = 0;
let updated = 0;
let newContacts = 0;
let flaggedPoorFit = 0;
let catCorrected = 0;
const errors = [];

for (const file of FINDINGS_FILES) {
  if (!fs.existsSync(file)) {
    console.log(`[cn06b-load] skip missing ${file}`);
    continue;
  }
  const findings = JSON.parse(fs.readFileSync(file, 'utf-8'));
  console.log(`[cn06b-load] processing ${file} with ${findings.length} findings`);
  for (const f of findings) {
    total += 1;
    const slug = trim(f.slug);
    if (!slug) { errors.push({ file, slug: f.slug, reason: 'missing slug' }); continue; }

    // Load the current partner.
    const current = await sb.from('network_partners')
      .select('id, display_name, vendor_category, research_sources, metadata, status, is_us_business, research_confidence, website')
      .eq('slug', slug)
      .maybeSingle();
    if (current.error || !current.data) {
      errors.push({ file, slug, reason: `partner lookup: ${current.error?.message ?? 'not found'}` });
      continue;
    }
    const partner = current.data;

    // Build patch.
    const nextCategory = parseCategoryChange(f.category_match);
    const sources = new Set(partner.research_sources ?? []);
    for (const url of [f.operational_source, f.us_business_source, f.public_email_source, f.contact_url, f.named_contact_source]) {
      if (typeof url === 'string' && url.startsWith('http')) sources.add(url.trim());
    }
    // Store verification metadata on partner.metadata so we don't need another column.
    const meta = { ...(partner.metadata ?? {}) };
    meta.cn06b_verified_on = today;
    meta.cn06b_operational = f.operational;
    meta.cn06b_us_business = f.us_business;
    meta.cn06b_commercial_fit = f.commercial_fit;
    if (f.commercial_fit_reason) meta.cn06b_commercial_fit_reason = f.commercial_fit_reason;
    if (f.research_notes) meta.cn06b_research_notes = f.research_notes;
    if (f.poor_fit === 'yes' && f.poor_fit_reason) meta.cn06b_poor_fit_reason = f.poor_fit_reason;

    const patch = {
      research_sources: Array.from(sources),
      metadata: meta,
      last_researched_at: new Date().toISOString(),
      research_confidence: f.operational === 'yes' && f.us_business === 'yes' ? 'high'
                          : f.operational === 'no' || f.us_business === 'no' ? 'low'
                          : 'medium',
    };
    if (nextCategory && nextCategory !== partner.vendor_category) {
      patch.vendor_category = nextCategory;
      catCorrected += 1;
    }
    if (f.us_business === 'no') patch.is_us_business = false;
    if (f.poor_fit === 'yes') {
      patch.status = 'nurture';
      patch.first_wave = false;
      flaggedPoorFit += 1;
    }

    const upd = await sb.from('network_partners').update(patch).eq('id', partner.id);
    if (upd.error) {
      errors.push({ file, slug, reason: `update: ${upd.error.message}` });
      continue;
    }
    updated += 1;

    // Create contact(s).
    // Rule: at most 1 "primary" contact per slug per run.
    // Order of preference:
    //   1. named_contact (if valid + has source) with their email if available
    //   2. public_email (anonymous)
    //   3. contact_url only (no email)

    const hasEmail = emailOk(f.public_email);
    const hasNamed = f.named_contact && f.named_contact_source && f.named_contact_source.startsWith('http');
    const hasForm = f.contact_url && f.contact_url.startsWith('http');

    const contactsToCreate = [];
    if (hasNamed) {
      contactsToCreate.push({
        partner_id: partner.id,
        full_name: trim(f.named_contact),
        role_title: trim(f.named_contact_role),
        email: hasEmail ? trim(f.public_email) : null,
        is_primary: true,
        email_verification: hasEmail ? 'public_listed' : null,
        email_verified_at: hasEmail ? new Date().toISOString() : null,
        source_url: f.named_contact_source,
        contact_url: f.contact_url && f.contact_url.startsWith('http') ? f.contact_url : null,
        notes: `[cn06b] Verified ${today}`,
      });
    } else if (hasEmail) {
      contactsToCreate.push({
        partner_id: partner.id,
        full_name: `${partner.display_name} — Public contact`,
        role_title: null,
        email: trim(f.public_email),
        is_primary: true,
        email_verification: 'public_listed',
        email_verified_at: new Date().toISOString(),
        source_url: f.public_email_source || partner.website,
        contact_url: f.contact_url && f.contact_url.startsWith('http') ? f.contact_url : null,
        notes: `[cn06b] Verified ${today}`,
      });
    } else if (hasForm) {
      contactsToCreate.push({
        partner_id: partner.id,
        full_name: `${partner.display_name} — Contact form`,
        role_title: null,
        email: null,
        is_primary: true,
        email_verification: null,
        source_url: f.contact_url,
        contact_url: f.contact_url,
        notes: `[cn06b] Contact form only. ${f.contact_url_description ?? ''} Verified ${today}`,
      });
    }

    if (contactsToCreate.length > 0) {
      // Check if we already created a cn06b-tagged contact for this partner.
      const existing = await sb.from('network_partner_contacts')
        .select('id, is_primary')
        .eq('partner_id', partner.id)
        .ilike('notes', '[cn06b]%');
      const alreadyMarked = (existing.data ?? []);
      if (alreadyMarked.length === 0) {
        // Demote any existing primary.
        await sb.from('network_partner_contacts')
          .update({ is_primary: false }).eq('partner_id', partner.id).eq('is_primary', true);
        for (const c of contactsToCreate) {
          const ins = await sb.from('network_partner_contacts').insert(c);
          if (ins.error) {
            errors.push({ file, slug, reason: `contact insert: ${ins.error.message}` });
            continue;
          }
          newContacts += 1;
        }
      } else {
        // Update the existing cn06b primary row in place.
        const target = alreadyMarked[0];
        const upd2 = await sb.from('network_partner_contacts').update(contactsToCreate[0]).eq('id', target.id);
        if (upd2.error) errors.push({ file, slug, reason: `contact update: ${upd2.error.message}` });
      }
    }
  }
}

console.log('--------------------------------------------');
console.log(`[cn06b-load] total findings       = ${total}`);
console.log(`[cn06b-load] partners updated     = ${updated}`);
console.log(`[cn06b-load] contacts created     = ${newContacts}`);
console.log(`[cn06b-load] poor_fit → nurture   = ${flaggedPoorFit}`);
console.log(`[cn06b-load] category corrections = ${catCorrected}`);
console.log(`[cn06b-load] errors               = ${errors.length}`);
if (errors.length) {
  for (const e of errors) console.log(`  - ${e.slug}: ${e.reason}`);
}
