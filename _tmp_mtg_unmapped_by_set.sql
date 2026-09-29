-- Classify unmapped by set_id
select tp.set_id, count(*) as n_printings,
       count(*) filter (where tp.tcgplayer_id is not null) as with_tcgp,
       count(*) filter (where tp.cardmarket_id is not null) as with_cardmarket
from tcg_printings tp
where tp.game_id = 'mtg' and tp.mtg_printings_id is null
group by tp.set_id order by n_printings desc;
