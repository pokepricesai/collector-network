-- Classify unmapped tcg_printings for MTG
with prices as (
  select mp.tcg_printing_id, mp.source, mp.price, mp.currency, tp.mtg_printings_id,
         tp.tcgplayer_id, tp.cardmarket_id, tp.tcggraph_card_id, tp.language, tp.finish, tp.edition, tp.collector_number
  from tcg_market_prices_current mp
  join tcg_printings tp on tp.id = mp.tcg_printing_id
  where mp.game_id = 'mtg' and mp.price is not null and mp.currency = 'USD'
)
select
  count(*) filter (where mtg_printings_id is null) as unmapped_rows,
  count(*) as total_usd_rows,
  round(100.0 * count(*) filter (where mtg_printings_id is null) / count(*), 2) as unmapped_pct,
  count(distinct tcg_printing_id) filter (where mtg_printings_id is null) as unmapped_printings,
  count(distinct tcg_printing_id) as total_printings
from prices;
