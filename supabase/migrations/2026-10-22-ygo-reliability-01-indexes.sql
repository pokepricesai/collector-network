-- YGO-RELIABILITY-01: single approved index covering the dominant
-- query shape that produced 46 of 50 confirmed Googlebot /
-- Bingbot / KeenableBot / Reflectionbot HTTP 500s on 2026-10-22.
--
-- Primary (46 of 50 failures): tcg_cards (game_id, collector_number)
--   Query: supabase.from('tcg_cards').select('*')
--            .eq('game_id', 'ygo').eq('collector_number', 'LOB-001')
--   Call site: apps/yugioh/src/server/card.ts
--     _getYugiohPhysicalPrintingByRoute → retryOnce('printing-card-lookup')
--   Why: existing indexes on tcg_cards cover (game_id, set_id) and
--   (game_id, name) but not (game_id, collector_number). With ~38k
--   YGO rows the planner falls back to a seq scan, which exceeds the
--   anon-role statement_timeout of 3 s under crawler load.
--
-- Rejected for now (per review): tcg_cards (set_id) and
-- tcg_printings (tcg_card_id). Hold until query plans demonstrate
-- they are necessary. See the amended review in the ticket.
--
-- Operator note on execution
-- --------------------------
-- Plain CREATE INDEX (no CONCURRENTLY) locks tcg_cards for writes
-- while building. At ~38k YGO rows plus similar scale for other
-- games it should complete sub-second — safe for interactive SQL
-- Editor use. The Supabase SQL Editor wraps the paste in a
-- transaction which cannot host CONCURRENTLY. If zero write-lock is
-- preferred, run via psql outside a transaction with CONCURRENTLY
-- appended.

CREATE INDEX IF NOT EXISTS tcg_cards_game_collector_idx
  ON public.tcg_cards (game_id, collector_number);

-- Rollback:
--   DROP INDEX IF EXISTS tcg_cards_game_collector_idx;
