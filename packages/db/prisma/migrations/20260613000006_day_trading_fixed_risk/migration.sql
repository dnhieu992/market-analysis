-- AlterTable: switch to fixed-dollar risk model + store position volume
ALTER TABLE `day_trading_signals`
  ADD COLUMN `quantity` DOUBLE NULL,
  ADD COLUMN `positionValue` DOUBLE NULL,
  ALTER COLUMN `riskAmount` SET DEFAULT 2,
  CHANGE COLUMN `pnlPercent` `pnlUsd` DOUBLE NULL;
