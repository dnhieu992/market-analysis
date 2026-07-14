-- AlterTable: add monitoring stage (near | reach | risk) + short reason note.
-- Existing rows were all strict-qualified entries, so default them to 'reach'.
ALTER TABLE `ema_stoch_signals` ADD COLUMN `stage` VARCHAR(10) NOT NULL DEFAULT 'reach';
ALTER TABLE `ema_stoch_signals` ADD COLUMN `note` VARCHAR(255) NULL;
