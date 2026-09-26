const { createTcgClient } = await import('../../../packages/database/src/client.ts');
const s = createTcgClient();
for (const t of ['tcg_cards', 'tcg_sets', 'tcg_market_prices_current', 'tcg_printings']) {
  const t0 = Date.now();
  const { count, error } = await s.from(t).select('id', { count: 'exact', head: true }).eq('game_id', 'onepiece');
  console.log(t, 'count=', count, 'error=', error?.message ?? null, 'ms=', Date.now() - t0);
}
