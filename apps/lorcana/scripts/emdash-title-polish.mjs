// Second pass: SEO/metadata title strings read awkwardly with a comma
// where the em-dash was separating a label from its description.
// Replace a comma with a colon on title-like strings only, after a
// recognisable "brand/subject + descriptor" pattern.

import fs from 'fs/promises';
import path from 'path';

const ROOT = path.resolve('apps/lorcana/src');

// (literal-regex, replacement) pairs. Keep the list explicit so no
// unintended rewrite can slip in — we scoped this to the title lines
// identified by inspection above.
const PATCHES = [
  // metadata titles
  ["'Lorcana AI, ask questions about any Lorcana card'", "'Lorcana AI: ask questions about any Lorcana card'"],
  ["'LorcanaPrices, every printing, every Enchanted for Disney Lorcana'", "'LorcanaPrices: every printing, every Enchanted for Disney Lorcana'"],
  ["'Disney Lorcana, every set catalogued'", "'Disney Lorcana: every set catalogued'"],
  ["'Lorcana card finder, filter by ink, rarity, type and inkability'", "'Lorcana card finder: filter by ink, rarity, type and inkability'"],
  ["'Enchanted Lorcana cards, full priced list, all sets'", "'Enchanted Lorcana cards: full priced list across every set'"],
  ["'Iconic Lorcana cards, every Iconic-tier overprint'", "'Iconic Lorcana cards: every Iconic-tier overprint'"],
  ["'Lorcana market, most valuable cards, Enchanted chase, Iconic overprints'", "'Lorcana market: most valuable cards, Enchanted chase, Iconic overprints'"],
  ["`${label} Lorcana cards, top-value, Enchanted and every printing`", "`${label} Lorcana cards: top-value, Enchanted and every printing`"],
  ["`${data.name}, every Lorcana card, printing and price`", "`${data.name}: every Lorcana card, printing and price`"],
  // in-body visible labels
  ["No cards matched, try a shorter query or check spelling.", "No cards matched. Try a shorter query or check spelling."],
  // option labels
  ['>Price, high to low<', '>Price: high to low<'],
  ['>Price, low to high<', '>Price: low to high<'],
];

async function walk(dir) {
  const out = [];
  for (const n of await fs.readdir(dir)) {
    const p = path.join(dir, n);
    const s = await fs.stat(p);
    if (s.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(tsx?|md)$/.test(n)) out.push(p);
  }
  return out;
}

const files = await walk(ROOT);
let totalPatched = 0;
let touched = 0;
for (const f of files) {
  let src = await fs.readFile(f, 'utf8');
  let changed = false;
  for (const [find, replace] of PATCHES) {
    if (src.includes(find)) {
      src = src.split(find).join(replace);
      changed = true;
      totalPatched += 1;
    }
  }
  if (changed) {
    await fs.writeFile(f, src, 'utf8');
    touched += 1;
    console.log(`  ${f.replace(/\\/g, '/').replace(/^.*apps\/lorcana\//, 'apps/lorcana/')}`);
  }
}
console.log(`\n${totalPatched} title-level polishes across ${touched} files`);
