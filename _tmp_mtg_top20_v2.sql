-- Re-do top-20 with LEFT JOIN so unmapped rows still show
select
  coalesce(oc.name, 'UNKNOWN') as name,
  p.set_code,
  p.collector_number,
  p.lang,
  mp.currency,
  mp.price,
  mp.source
from tcg_market_prices_current mp
left join tcg_printings tp on tp.id = mp.tcg_printing_id
left join mtg_printings p on p.id = tp.mtg_printings_id
left join mtg_oracle_cards oc on oc.id = p.oracle_card_id
where mp.game_id = 'mtg'
  and mp.currency = 'USD'
  and mp.price is not null
order by mp.price desc
limit 25;
