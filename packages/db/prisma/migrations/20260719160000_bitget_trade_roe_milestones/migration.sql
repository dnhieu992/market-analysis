-- AlterTable: ROE% milestone ratchets on the Bitget trade lifecycle row.
ALTER TABLE `bitget_trades` ADD COLUMN `peakRoePct` INTEGER NULL;
ALTER TABLE `bitget_trades` ADD COLUMN `troughRoePct` INTEGER NULL;
