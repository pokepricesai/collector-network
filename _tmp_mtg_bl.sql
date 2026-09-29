-- Verify Black Lotus LEA mapping (and check if that mtg_printings row exists)
select p.id, p.set_code, p.collector_number, p.lang, p.name, oc.name as oracle_name, oc.id as oracle_id
from mtg_printings p
left join mtg_oracle_cards oc on oc.id = p.oracle_card_id
where p.id in (
  '12802b12-fd81-482e-9602-07b2af970dd6',  -- 30a-501
  'e06664ef-891a-48e4-9d8a-ec615bf56000',  -- spm-242 foil
  'c57169c6-6c85-4cad-83ad-1ce7b58a8008',  -- lea-232
  '73692128-2731-4198-9b6a-86255224ceea',  -- leb-233
  '4447d6b8-a7d8-47a0-b479-6c731042e643'   -- sum-275
);
