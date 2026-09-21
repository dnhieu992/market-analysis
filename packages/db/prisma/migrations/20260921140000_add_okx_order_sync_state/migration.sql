-- CreateTable: singleton anchor for the read-only OKX order sync into /trades.
CREATE TABLE `okx_order_sync_state` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
  `historyStartAt` DATETIME(3) NULL,
  `baseline` JSON NOT NULL DEFAULT ('[]'),
  `updatedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
