-- AlterTable: per-coin risk settings
ALTER TABLE `tracking_coins`
  ADD COLUMN `swingMaxLoss`    DOUBLE NULL,
  ADD COLUMN `swingMinRR`      DOUBLE NULL,
  ADD COLUMN `daytradeMaxLoss` DOUBLE NULL,
  ADD COLUMN `daytradeMinRR`   DOUBLE NULL;

-- AlterTable: computed position size stored on order
ALTER TABLE `tracking_coin_orders`
  ADD COLUMN `positionSize`  DOUBLE NULL,
  ADD COLUMN `positionValue` DOUBLE NULL;
