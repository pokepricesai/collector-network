-- Direct query on the mystery printings' price rows
select tp.id, tp.mtg_printings_id::text, tp.finish, mp.source, mp.currency, mp.price, mp.updated_at::text as updated_at
from tcg_market_prices_current mp
join tcg_printings tp on tp.id = mp.tcg_printing_id
where tp.id in (
  'mtg:print:mtg_07b7a98c-397:normal:en',
  'mtg:print:mtg_b0faa7f2-b54:normal:en',
  'mtg:print:mtg_f1bafbb8-1c8:normal:en',
  'mtg:print:mtg_b3a69a1c-c80:normal:en',
  'mtg:print:mtg_2c3df372-09d:foil:en'
) and mp.currency='USD'
order by mp.price desc;
