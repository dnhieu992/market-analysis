-- AlterTable
ALTER TABLE `swing_trading_signals` ADD COLUMN `partialClosed` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `swing_trading_signals` ADD COLUMN `realizedPnlUsd` DOUBLE NOT NULL DEFAULT 0;
