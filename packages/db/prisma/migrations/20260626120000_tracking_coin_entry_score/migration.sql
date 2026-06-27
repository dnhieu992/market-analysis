-- AlterTable
ALTER TABLE `tracking_coin_signals` ADD COLUMN `entryScore` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `extPct` DOUBLE NULL;
