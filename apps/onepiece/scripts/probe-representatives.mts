const { createTcgClient } = await import('../../../packages/database/src/client.ts');
const s = createTcgClient();

// Simple helper to fetch and print a small set
async function pick(label: string, rarityFilter: string | null, cnLike: string | null) {
  let q = s.from('tcg_cards').select('collector_number, name, rarity, set_id').eq('game_id', 'onepiece').limit(3);
  if (rarityFilter) q = q.eq('rarity', rarityFilter);
  if (cnLike) q = q.ilike('collector_number', cnLike);
  const { data } = await q;
  console.log(`\n${label}:`);
  for (const r of (data as any[] | null) ?? []) console.log(`  ${r.collector_number}  ${r.name}  ${r.rarity}  set=${r.set_id}`);
}

await pick('Base cards (C)', 'C', null);
await pick('Leader (L)', 'L', null);
await pick('Leader with _p (parallels)', 'L', '%_p1');
await pick('SEC', 'SEC', null);
await pick('SP CARD', 'SP CARD', null);
await pick('TR (Treasure)', 'TR', null);
await pick('P (Promo)', 'P', null);
await pick('_r1 (Reprint)', null, '%_r1');
