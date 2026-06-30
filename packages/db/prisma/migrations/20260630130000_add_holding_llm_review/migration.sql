-- AlterTable: tag each DCA layer with how it was entered (signal vs FOMO)
ALTER TABLE `tracking_coin_dca_buys` ADD COLUMN `entryMode` VARCHAR(8) NULL;

-- AlterTable: daily LLM (Haiku) review of an open holding, stored on the signal history feed
ALTER TABLE `tracking_coin_signal_history` ADD COLUMN `entryMode` VARCHAR(8) NULL;
ALTER TABLE `tracking_coin_signal_history` ADD COLUMN `avgEntry` DOUBLE NULL;
ALTER TABLE `tracking_coin_signal_history` ADD COLUMN `pnlPct` DOUBLE NULL;
ALTER TABLE `tracking_coin_signal_history` ADD COLUMN `llmVerdict` VARCHAR(12) NULL;
ALTER TABLE `tracking_coin_signal_history` ADD COLUMN `llmReview` TEXT NULL;
ALTER TABLE `tracking_coin_signal_history` ADD COLUMN `llmModel` VARCHAR(40) NULL;
