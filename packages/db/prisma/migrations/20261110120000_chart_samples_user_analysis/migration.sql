-- AlterTable
ALTER TABLE `chart_samples` ADD COLUMN `tpPrice` DOUBLE NULL,
    ADD COLUMN `slPrice` DOUBLE NULL,
    ADD COLUMN `aiSummary` TEXT NULL,
    ADD COLUMN `analyzedAt` DATETIME(3) NULL;

-- entryPrice is now the user's own price; the candle close lives in features.close
UPDATE `chart_samples` SET `entryPrice` = NULL;
