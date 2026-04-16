-- Change TradingStrategy.id from VARCHAR(191) to CHAR(36) for UUID storage
ALTER TABLE `TradingStrategy` MODIFY COLUMN `id` CHAR(36) NOT NULL;
