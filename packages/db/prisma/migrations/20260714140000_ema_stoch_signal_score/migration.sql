-- AlterTable: add 0–100 weighted setup-completeness score for the scored /ema-bounce cards.
ALTER TABLE `ema_stoch_signals` ADD COLUMN `score` INT NOT NULL DEFAULT 0;
