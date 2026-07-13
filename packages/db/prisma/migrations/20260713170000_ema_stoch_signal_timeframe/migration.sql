-- AlterTable: add scan timeframe (existing rows are all from the 4h scanner)
ALTER TABLE `ema_stoch_signals` ADD COLUMN `timeframe` VARCHAR(10) NOT NULL DEFAULT '4h';

-- Replace the (coinId, triggeredAt) unique with (coinId, timeframe, triggeredAt).
-- Create the new index FIRST: its leftmost column is coinId, so it keeps covering the
-- coinId foreign key — otherwise MySQL refuses to drop the old index (needed by the FK).
CREATE UNIQUE INDEX `ema_stoch_signals_coinId_timeframe_triggeredAt_key` ON `ema_stoch_signals`(`coinId`, `timeframe`, `triggeredAt`);
DROP INDEX `ema_stoch_signals_coinId_triggeredAt_key` ON `ema_stoch_signals`;
