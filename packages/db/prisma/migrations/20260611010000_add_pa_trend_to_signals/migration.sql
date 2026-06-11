-- AlterTable
ALTER TABLE `tracking_coin_signals` ADD COLUMN `trend` VARCHAR(15) NOT NULL DEFAULT 'Neutral';
ALTER TABLE `tracking_coin_signals` ADD COLUMN `swingStructure` VARCHAR(10) NOT NULL DEFAULT 'Mixed';

-- AlterTable
ALTER TABLE `small_cap_signals` ADD COLUMN `trend` VARCHAR(15) NOT NULL DEFAULT 'Neutral';
ALTER TABLE `small_cap_signals` ADD COLUMN `swingStructure` VARCHAR(10) NOT NULL DEFAULT 'Mixed';
