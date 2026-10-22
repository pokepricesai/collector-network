// CN-06A: recompute fit_score for every US business and flag the top-25
// as first_wave. Pulls from v_crm_vendor_scoring (deterministic 100-pt
// formula). Writes fit_score + fit_score_breakdown back to network_partners.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

// Load every scored US business.
const scoring = await sb.from('v_crm_vendor_scoring')
  .select('id, display_name, vendor_category, audience_pts, commercial_pts, placement_pts, contact_pts, cross_tcg_pts')
  .not('vendor_category', 'is', null)
  .limit(5000);
if (scoring.error) throw new Error(`[cn06a-score] view: ${scoring.error.message}`);

const results = [];
for (const row of scoring.data) {
  const breakdown = {
    audience: row.audience_pts ?? 0,
    commercial: row.commercial_pts ?? 0,
    placement: row.placement_pts ?? 0,
    contact: row.contact_pts ?? 0,
    cross_tcg: row.cross_tcg_pts ?? 0,
  };
  const total = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));
  results.push({ id: row.id, name: row.display_name, category: row.vendor_category, total, breakdown });
}
results.sort((a, b) => b.total - a.total);

console.log(`[cn06a-score] scored ${results.length} partners`);

// Write fit_score + breakdown.
let written = 0;
for (const r of results) {
  const { error } = await sb.from('network_partners')
    .update({ fit_score: r.total, fit_score_breakdown: r.breakdown })
    .eq('id', r.id);
  if (error) {
    console.log(`[cn06a-score] update ${r.name}: ${error.message}`);
    continue;
  }
  written += 1;
}
console.log(`[cn06a-score] wrote scores for ${written} partners`);

// Flag top-25 as first_wave. Clear existing wave first for determinism.
await sb.from('network_partners').update({ first_wave: false }).eq('first_wave', true);

const topIds = results.slice(0, 25).map((r) => r.id);
if (topIds.length > 0) {
  const { error } = await sb.from('network_partners').update({ first_wave: true }).in('id', topIds);
  if (error) throw new Error(`[cn06a-score] first_wave flag: ${error.message}`);
}
console.log(`[cn06a-score] flagged ${topIds.length} first-wave prospects:`);
for (const r of results.slice(0, 25)) {
  console.log(`  ${r.total.toString().padStart(3)}  ${r.category.padEnd(28)}  ${r.name}`);
}
