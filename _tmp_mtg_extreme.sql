-- Extreme unmapped printings — the $200k+ mystery
select
  tp.id, tp.tcggraph_card_id, tp.set_id, tp.collector_number, tp.language, tp.finish, tp.edition,
  tp.tcgplayer_id, tp.cardmarket_id,
  mp.source, mp.price, mp.currency, mp.updated_at::text as updated_at
from tcg_printings tp
join tcg_market_prices_current mp on mp.tcg_printing_id = tp.id
where tp.game_id = 'mtg' and tp.mtg_printings_id is null
  and mp.currency = 'USD'
order by mp.price desc
limit 10;
