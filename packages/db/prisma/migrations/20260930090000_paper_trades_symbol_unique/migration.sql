-- One paper strategy now runs on several symbols (BTC, ETH): the same strategy may open the
-- same candle on each symbol, so the per-candle uniqueness includes the symbol.

-- DropIndex
DROP INDEX `strategy_paper_trades_strategyId_openedAt_direction_key` ON `strategy_paper_trades`;

-- CreateIndex
CREATE UNIQUE INDEX `strategy_paper_trades_strategyId_symbol_openedAt_direction_key` ON `strategy_paper_trades`(`strategyId`, `symbol`, `openedAt`, `direction`);
