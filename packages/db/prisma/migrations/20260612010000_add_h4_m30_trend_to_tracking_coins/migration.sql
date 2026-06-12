-- AlterTable
ALTER TABLE `tracking_coin_signals` ADD COLUMN `h4Trend` VARCHAR(15) NOT NULL DEFAULT 'Neutral';
ALTER TABLE `tracking_coin_signals` ADD COLUMN `m30Trend` VARCHAR(15) NOT NULL DEFAULT 'Neutral';
