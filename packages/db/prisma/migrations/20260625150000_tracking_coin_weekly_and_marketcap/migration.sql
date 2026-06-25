-- AlterTable: market cap for ordering
ALTER TABLE `tracking_coins` ADD COLUMN `marketCap` DOUBLE NULL;

-- AlterTable: weekly (W1) timeframe indicators + UTBot weekly
ALTER TABLE `tracking_coin_signals` ADD COLUMN `weekTrend` VARCHAR(15) NOT NULL DEFAULT 'Neutral';
ALTER TABLE `tracking_coin_signals` ADD COLUMN `utBotW1Bullish` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `wEma34Above` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `wEma89Above` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `wEma200Above` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `wRsi` DOUBLE NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `wVolMultiplier` DOUBLE NULL;
