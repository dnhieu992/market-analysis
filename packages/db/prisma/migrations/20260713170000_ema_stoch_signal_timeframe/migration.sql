-- AlterTable: add scan timeframe (existing rows are all from the 4h scanner)
ALTER TABLE `ema_stoch_signals` ADD COLUMN `timeframe` VARCHAR(10) NOT NULL DEFAULT '4h';

-- Replace the (coinId, triggeredAt) unique with (coinId, timeframe, triggeredAt)
-- so a 4h and a 1d signal on the same coin/candle-time can coexist.
DROP INDEX `ema_stoch_signals_coinId_triggeredAt_key` ON `ema_stoch_signals`;
CREATE UNIQUE INDEX `ema_stoch_signals_coinId_timeframe_triggeredAt_key` ON `ema_stoch_signals`(`coinId`, `timeframe`, `triggeredAt`);
