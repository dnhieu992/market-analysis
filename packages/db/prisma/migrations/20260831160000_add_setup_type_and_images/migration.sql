-- /strategy-backtest: setups now carry the horizon they were planned on and the
-- chart screenshots the analysis was based on.
--
-- `INVALID` also joins the status vocabulary (a setup the trader calls off, so it
-- stops being tracked and is left out of the scorecard). That is a value change
-- only — `status` is already a VARCHAR, so no column change is needed for it.

-- AlterTable
ALTER TABLE `strategy_backtest_setups`
    ADD COLUMN `setupType` VARCHAR(10) NOT NULL DEFAULT 'SWING',
    ADD COLUMN `images` JSON NOT NULL DEFAULT (JSON_ARRAY());
