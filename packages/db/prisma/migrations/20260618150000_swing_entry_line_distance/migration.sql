-- AlterTable
ALTER TABLE `swing_trading_signals` ADD COLUMN `entryLineDistancePct` DOUBLE NULL;

-- Backfill existing rows. The entry-time UTBot line is preserved in setupJson.utbotStop
-- (the live stopLoss column trails away over the position's life, so it can't be used here).
UPDATE `swing_trading_signals`
SET `entryLineDistancePct` =
  ABS(`entryPrice` - CAST(JSON_UNQUOTE(JSON_EXTRACT(`setupJson`, '$.utbotStop')) AS DECIMAL(40, 18)))
    / `entryPrice` * 100
WHERE `entryPrice` > 0
  AND JSON_VALID(`setupJson`)
  AND JSON_EXTRACT(`setupJson`, '$.utbotStop') IS NOT NULL;
