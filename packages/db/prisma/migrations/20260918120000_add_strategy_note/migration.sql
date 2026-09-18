-- AlterTable: personal free-text note per strategy (separate from the backtest `content`)
ALTER TABLE `TradingStrategy` ADD COLUMN `note` TEXT NULL;
