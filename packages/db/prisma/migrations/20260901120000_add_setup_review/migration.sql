-- /strategy-backtest: a setup can now carry a post-mortem written after the fact —
-- markdown plus its own screenshots, edited from the Review dialog on the card.
-- Separate from `note` on purpose: `note` is the plan (why the setup was taken),
-- `review` is the verdict (what actually happened and what to change).

-- AlterTable
ALTER TABLE `strategy_backtest_setups`
    ADD COLUMN `review` LONGTEXT NULL,
    ADD COLUMN `reviewImages` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    ADD COLUMN `reviewedAt` DATETIME(3) NULL;
