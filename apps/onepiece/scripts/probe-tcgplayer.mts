// Card-art fallback probe. Given TCGCollector is Cloudflare-locked
// against bots and their OP subdomain doesn't exist, characterise
// whether TCGplayer product images could work: is tcgplayer_id
// populated on OP printings, do the CDN URLs load with no Referer?

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_ANON_KEY']!);

async function main() {
  const games = await supabase.from('tcg_games').select('id, slug');
  const op = games.data?.find((g: { slug: string }) => g.slug === 'one-piece');
  if (!op) throw new Error('no OP game');
  const opId = op.id;

  console.log('=== TCGplayer ID coverage on OP printings ===');
  const total = await supabase
    .from('tcg_printings')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', opId);
  const withTcgp = await supabase
    .from('tcg_printings')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', opId)
    .not('tcgplayer_id', 'is', null);
  const withCm = await supabase
    .from('tcg_printings')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', opId)
    .not('cardmarket_id', 'is', null);
  console.log('total OP printings :', total.count);
  console.log('with tcgplayer_id  :', withTcgp.count);
  console.log('with cardmarket_id :', withCm.count);

  console.log('\n=== Sample IDs from a Leader printing ===');
  const sample = await supabase
    .from('tcg_printings')
    .select('id, tcgplayer_id, cardmarket_id, set_id, tcg_card_id, finish, edition')
    .eq('game_id', opId)
    .not('tcgplayer_id', 'is', null)
    .limit(5);
  console.log(JSON.stringify(sample.data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
