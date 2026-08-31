-- Manual setup tracker behind /strategy-backtest. Standalone table on purpose:
-- no FK to Order/Signal/TrackingCoin so the trader's own scorecard is never
-- affected by the automated pipelines.

-- CreateTable
CREATE TABLE `strategy_backtest_setups` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    `direction` VARCHAR(5) NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `takeProfit` DOUBLE NULL,
    `note` TEXT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `triggeredAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `exitPrice` DOUBLE NULL,
    `pnlPct` DOUBLE NULL,
    `rMultiple` DOUBLE NULL,
    `lastPrice` DOUBLE NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `strategy_backtest_setups_status_idx`(`status`),
    INDEX `strategy_backtest_setups_createdAt_idx`(`createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
