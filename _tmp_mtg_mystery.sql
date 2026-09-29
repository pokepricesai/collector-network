-- What are the 5 mystery high-price printings?
select
  tp.id, tp.game_id, tp.set_id, tp.collector_number, tp.language, tp.finish,
  tp.tcgplayer_id, tp.cardmarket_id, tp.mtg_printings_id,
  tp.tcggraph_card_id
from tcg_printings tp
where tp.id in (
  'mtg:print:mtg_07b7a98c-397:normal:en',
  'mtg:print:mtg_b0faa7f2-b54:normal:en',
  'mtg:print:mtg_f1bafbb8-1c8:normal:en',
  'mtg:print:mtg_b3a69a1c-c80:normal:en',
  'mtg:print:mtg_2c3df372-09d:foil:en'
);
