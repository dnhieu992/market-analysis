-- AlterTable: M30 display-only indicators on tracking_coin_signals
ALTER TABLE `tracking_coin_signals` ADD COLUMN `utBotM30Bullish` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `m30Ema34Above` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `m30Ema89Above` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `m30Ema200Above` BOOLEAN NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `m30Rsi` DOUBLE NULL;
ALTER TABLE `tracking_coin_signals` ADD COLUMN `m30VolMultiplier` DOUBLE NULL;
