-- DropIndex
DROP INDEX `pnl_history_portfolioId_date_idx` ON `pnl_history`;

-- DropIndex
DROP INDEX `transactions_transactedAt_idx` ON `transactions`;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `symbolsTracking` JSON NOT NULL;

-- CreateIndex
CREATE INDEX `pnl_history_portfolioId_date_idx` ON `pnl_history`(`portfolioId`, `date` DESC);

-- CreateIndex
CREATE INDEX `transactions_transactedAt_idx` ON `transactions`(`transactedAt` DESC);
