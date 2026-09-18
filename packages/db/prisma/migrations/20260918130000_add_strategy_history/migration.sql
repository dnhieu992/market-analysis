-- CreateTable: append-only scan/analysis log per strategy (History tab)
CREATE TABLE `StrategyHistory` (
  `id` CHAR(36) NOT NULL,
  `strategyId` CHAR(36) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `StrategyHistory_strategyId_createdAt_idx`(`strategyId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
