-- CreateTable
CREATE TABLE `swing_trading_signals` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `timeframe` VARCHAR(10) NOT NULL DEFAULT '4h',
    `setupType` VARCHAR(30) NOT NULL DEFAULT 'UTBOT_FLIP',
    `direction` VARCHAR(5) NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `takeProfit` DOUBLE NOT NULL,
    `rrRatio` DOUBLE NOT NULL DEFAULT 0,
    `riskAmount` DOUBLE NOT NULL DEFAULT 1000,
    `keyValue` DOUBLE NOT NULL DEFAULT 2,
    `quantity` DOUBLE NULL,
    `positionValue` DOUBLE NULL,
    `status` VARCHAR(20) NOT NULL,
    `mode` VARCHAR(10) NOT NULL DEFAULT 'PAPER',
    `breakEvenMoved` BOOLEAN NOT NULL DEFAULT false,
    `closedPrice` DOUBLE NULL,
    `closedAt` DATETIME(3) NULL,
    `pnlUsd` DOUBLE NULL,
    `setupJson` TEXT NOT NULL,
    `note` TEXT NULL,
    `detectedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `swing_trading_signals_symbol_status_detectedAt_idx`(`symbol`, `status`, `detectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `swing_trading_settings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `symbol` VARCHAR(20) NOT NULL DEFAULT 'ETHUSDT',
    `timeframe` VARCHAR(10) NOT NULL DEFAULT '4h',
    `atrPeriod` INTEGER NOT NULL DEFAULT 10,
    `keyValue` DOUBLE NOT NULL DEFAULT 2,
    `riskPerTrade` DOUBLE NOT NULL DEFAULT 1000,
    `leverage` INTEGER NOT NULL DEFAULT 1,
    `mode` VARCHAR(10) NOT NULL DEFAULT 'PAPER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
