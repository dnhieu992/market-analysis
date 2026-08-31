-- /strategy-backtest: a setup can now be entered at market instead of resting at a limit.
--
-- Existing rows are all limit orders, which is what the default backfills. A MARKET
-- setup is written straight to ENTERED with the live price as its entry, so it never
-- passes through PENDING.

-- AlterTable
ALTER TABLE `strategy_backtest_setups` ADD COLUMN `orderType` VARCHAR(10) NOT NULL DEFAULT 'LIMIT';
