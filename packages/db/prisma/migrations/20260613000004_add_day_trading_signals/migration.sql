-- CreateTable
CREATE TABLE `day_trading_signals` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `setupType` VARCHAR(30) NOT NULL,
    `direction` VARCHAR(5) NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `takeProfit` DOUBLE NOT NULL,
    `rrRatio` DOUBLE NOT NULL DEFAULT 2.0,
    `riskAmount` DOUBLE NOT NULL DEFAULT 100,
    `status` VARCHAR(20) NOT NULL,
    `closedPrice` DOUBLE NULL,
    `closedAt` DATETIME(3) NULL,
    `pnlPercent` DOUBLE NULL,
    `setupJson` TEXT NOT NULL,
    `detectedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `day_trading_signals_symbol_status_detectedAt_idx`(`symbol`, `status`, `detectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
