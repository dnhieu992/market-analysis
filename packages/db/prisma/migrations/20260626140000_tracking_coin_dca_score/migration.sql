-- AlterTable
ALTER TABLE `tracking_coin_signals` ADD COLUMN `dcaScore` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `low20Pct` DOUBLE NULL;
