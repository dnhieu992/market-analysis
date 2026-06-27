-- AlterTable: link each DCA layer to its mirrored portfolio transaction (two-way sync)
ALTER TABLE `tracking_coin_dca_buys`
  ADD COLUMN `portfolioId` CHAR(36) NULL,
  ADD COLUMN `transactionId` CHAR(36) NULL;

-- CreateIndex: reverse lookup (portfolio transaction → DCA layer)
CREATE INDEX `tracking_coin_dca_buys_transactionId_idx` ON `tracking_coin_dca_buys`(`transactionId`);
