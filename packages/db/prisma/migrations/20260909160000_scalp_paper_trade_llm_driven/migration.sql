-- Switch scalp_paper_trades to LLM-driven decisions: drop the automatic
-- breakeven-ratchet flag (Claude now adjusts the stop freely each tick) and add
-- columns to track which model decided and its latest running commentary.
-- Table has zero rows in production at the time of this migration.

-- AlterTable
ALTER TABLE `scalp_paper_trades`
  DROP COLUMN `movedToBreakeven`,
  ADD COLUMN `lastNote` TEXT NULL,
  ADD COLUMN `model` VARCHAR(60) NULL;
