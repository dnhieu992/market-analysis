-- AlterTable: widen outcome to fit 'expired' (P4 — order expiry)
ALTER TABLE `tracking_coin_orders` MODIFY `outcome` VARCHAR(10) NULL;
