-- AlterTable
ALTER TABLE `tracking_coin_signals` ADD COLUMN `accZone` VARCHAR(5) NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `accDrawdownPct` DOUBLE NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `accBaseWidthPct` DOUBLE NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `accInBase` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `accGatePassed` BOOLEAN NULL;
