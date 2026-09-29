-- Sample unmapped rows to classify
select distinct on (tp.id)
  tp.id as tcg_printing_id,
  tp.tcggraph_card_id,
  tp.language,
  tp.finish,
  tp.edition,
  tp.collector_number,
  tp.tcgplayer_id,
  tp.cardmarket_id,
  tp.set_id,
  max(mp.price) as max_usd_price
from tcg_printings tp
left join tcg_market_prices_current mp on mp.tcg_printing_id = tp.id and mp.currency='USD'
where tp.game_id = 'mtg' and tp.mtg_printings_id is null
group by tp.id, tp.tcggraph_card_id, tp.language, tp.finish, tp.edition, tp.collector_number, tp.tcgplayer_id, tp.cardmarket_id, tp.set_id
order by tp.id, max(mp.price) desc nulls last
limit 30;
