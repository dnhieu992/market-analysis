-- CreateTable
CREATE TABLE `BackTestResult` (
    `id` VARCHAR(191) NOT NULL,
    `strategy` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `timeframe` VARCHAR(191) NOT NULL,
    `fromDate` DATETIME(3) NOT NULL,
    `toDate` DATETIME(3) NOT NULL,
    `totalTrades` INTEGER NOT NULL,
    `winRate` DOUBLE NOT NULL,
    `totalPnl` DOUBLE NOT NULL,
    `maxDrawdown` DOUBLE NOT NULL,
    `sharpeRatio` DOUBLE NULL,
    `tradesJson` LONGTEXT NOT NULL,
    `parametersJson` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BackTestResult_strategy_symbol_createdAt_idx`(`strategy`, `symbol`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
