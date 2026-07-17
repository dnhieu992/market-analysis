-- AlterTable
-- PA block for the /ema-bounce score: higher-timeframe trend + entry-timeframe swing
-- structure. Nullable — cards created before this migration have no PA read.
ALTER TABLE `ema_stoch_signals` ADD COLUMN `htfTrend` VARCHAR(12) NULL;
ALTER TABLE `ema_stoch_signals` ADD COLUMN `swingStructure` VARCHAR(8) NULL;
