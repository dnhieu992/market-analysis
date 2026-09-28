-- /trading-analysis now paper-trades several strategies in parallel (PDH/PDL breakout +
-- RSI/volume strategies). Every trade is linked to its strategy; each strategy keeps at
-- most one OPEN trade, enforced by the engine. PDH/PDL levels only apply to 'pdhl-btc'.

-- AlterTable
ALTER TABLE `strategy_paper_trades`
    ADD COLUMN `strategyId` VARCHAR(40) NOT NULL DEFAULT 'pdhl-btc',
    MODIFY `pdh` DOUBLE NULL,
    MODIFY `pdl` DOUBLE NULL;

-- DropIndex (one-per-side-per-day is now a PDH/PDL-only rule, checked in code)
DROP INDEX `strategy_paper_trades_tradeDate_direction_key` ON `strategy_paper_trades`;

-- CreateIndex
CREATE UNIQUE INDEX `strategy_paper_trades_strategyId_openedAt_direction_key` ON `strategy_paper_trades`(`strategyId`, `openedAt`, `direction`);
CREATE INDEX `strategy_paper_trades_strategyId_status_idx` ON `strategy_paper_trades`(`strategyId`, `status`);
