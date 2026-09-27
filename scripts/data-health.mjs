#!/usr/bin/env node
// data-health.mjs — reusable read-only diagnostic across the shared
// tcg_* tables. Answers: "Is each specialist site receiving fresh
// price data automatically?"
//
// Anon Supabase creds only. No writes. No service-role. No secret
// values ever printed.
//
// Run:  node scripts/data-health.mjs

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'));

function loadEnv(rel) {
  const p = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

const env = loadEnv('apps/yugioh/.env.local');
const BASE = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
if (!BASE || !KEY) { console.error('Missing Supabase env'); process.exit(1); }

async function pg(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${q}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : [];
}

async function count(table, filter = '') {
  const q = `${table}?select=game_id${filter ? '&' + filter : ''}&limit=1`;
  const r = await fetch(`${BASE}/rest/v1/${q}`, {
    method: 'HEAD',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0',
    },
  });
  const cr = r.headers.get('content-range');
  if (!cr) return null;
  const m = cr.match(/\/(\*|\d+)$/);
  return m ? (m[1] === '*' ? null : Number(m[1])) : null;
}

async function newest(table, col, filter = '') {
  const q = `${table}?select=${col}${filter ? '&' + filter : ''}&order=${col}.desc&limit=1`;
  const d = await pg(q);
  return d[0]?.[col] || null;
}

async function distinctSample(table, col, filter = '', n = 5) {
  const q = `${table}?select=${col}${filter ? '&' + filter : ''}&limit=${n * 20}`;
  const d = await pg(q);
  const seen = new Set();
  for (const row of d) { if (row[col] != null) seen.add(row[col]); if (seen.size >= n) break; }
  return [...seen];
}

const TARGETS = [
  { slug: 'yugioh', id: 'ygo' },
  { slug: 'one-piece', id: 'onepiece' },
  { slug: 'disney-lorcana', id: 'lorcana' },
];

async function main() {
  const games = await pg('tcg_games?select=id,slug,name');
  const byId = Object.fromEntries(games.map((g) => [g.id, g]));

  console.log('\n=== TCG DATA-HEALTH (read-only, anon) ===\n');
  const nowUtc = new Date();

  for (const t of TARGETS) {
    const g = byId[t.id];
    if (!g) { console.log(`▶ ${t.slug}: GAME NOT VISIBLE via anon`); continue; }
    const F = `game_id=eq.${g.id}`;

    const [sets, cards, printings, newestPrinting] = await Promise.all([
      count('tcg_sets', F),
      count('tcg_cards', F),
      count('tcg_printings', F),
      newest('tcg_printings', 'created_at', F),
    ]);

    const [retailCurrent, newestRetailCurrent, retailDaily, newestRetailDaily] = await Promise.all([
      count('tcg_market_prices_current', F),
      newest('tcg_market_prices_current', 'updated_at', F),
      count('tcg_market_price_daily', F),
      newest('tcg_market_price_daily', 'observed_on', F),
    ]);

    const [gradedCurrent, newestGradedCurrent, gradedDaily, newestGradedDaily] = await Promise.all([
      count('tcg_graded_prices_current', F),
      newest('tcg_graded_prices_current', 'updated_at', F),
      count('tcg_graded_price_daily', F),
      newest('tcg_graded_price_daily', 'observed_on', F),
    ]);

    const currencies = await distinctSample('tcg_market_prices_current', 'currency', F).catch(() => []);
    const sources = await distinctSample('tcg_market_prices_current', 'source', F).catch(() => []);
    const regions = await distinctSample('tcg_market_prices_current', 'region', F).catch(() => []);
    const graders = await distinctSample('tcg_graded_prices_current', 'grader', F, 8).catch(() => []);

    // Age calc for retail daily
    const ageDays = (iso) => {
      if (!iso) return null;
      const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00Z' : ''));
      return Math.floor((nowUtc - d) / 86400000);
    };

    const verdict = (() => {
      const ad = ageDays(newestRetailDaily);
      if (ad == null) return 'NO retail-daily observation for this game';
      if (ad <= 1) return `FRESH (retail-daily ${ad}d old)`;
      if (ad <= 3) return `OK (retail-daily ${ad}d old)`;
      return `STALE (retail-daily ${ad}d old)`;
    })();

    console.log(`▶ ${g.name}  [slug=${g.slug}, game_id=${g.id}]`);
    console.log(`  Catalogue     : sets=${sets}   cards=${cards}   printings=${printings}`);
    console.log(`  Newest printing added: ${newestPrinting}`);
    console.log(`  Retail current: rows=${retailCurrent}   newest updated_at=${newestRetailCurrent}`);
    console.log(`  Retail daily  : rows=${retailDaily}   newest observed_on=${newestRetailDaily}`);
    console.log(`  Graded current: rows=${gradedCurrent}   newest updated_at=${newestGradedCurrent}`);
    console.log(`  Graded daily  : rows=${gradedDaily}   newest observed_on=${newestGradedDaily}`);
    console.log(`  Currencies    : ${currencies.join(', ') || '(none visible)'}`);
    console.log(`  Sources       : ${sources.join(', ') || '(none visible)'}`);
    console.log(`  Regions       : ${regions.join(', ') || '(none visible)'}`);
    console.log(`  Graders       : ${graders.join(', ') || '(none visible)'}`);
    console.log(`  VERDICT       : ${verdict}`);
    console.log('');
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
