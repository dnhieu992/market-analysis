-- /strategy-backtest: marking a setup INVALID can now carry a reason.
--
-- The cancel action and the delete endpoint were dropped in the same change — a
-- setup is never removed now, so the board keeps every plan the trader ever wrote.
-- No data migration is needed: `CANCELLED` leaves the vocabulary with zero rows
-- ever having used it, and `status` is a plain VARCHAR.

-- AlterTable
ALTER TABLE `strategy_backtest_setups` ADD COLUMN `invalidReason` TEXT NULL;
