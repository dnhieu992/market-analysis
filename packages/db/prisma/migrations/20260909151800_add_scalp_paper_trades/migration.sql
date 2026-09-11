-- Paper (simulated) trade log for the M15 scalp monitor. Standalone table on
-- purpose: no FK to Order/Signal — this is a monitoring experiment, not a live
-- trading pipeline.

-- CreateTable
CREATE TABLE `scalp_paper_trades` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    `direction` VARCHAR(5) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `entryPrice` DOUBLE NOT NULL,
    `initialStopLoss` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `takeProfit` DOUBLE NOT NULL,
    `riskUsd` DOUBLE NOT NULL DEFAULT 1,
    `quantity` DOUBLE NOT NULL,
    `rrPlanned` DOUBLE NOT NULL,
    `movedToBreakeven` BOOLEAN NOT NULL DEFAULT false,
    `h1Trend` VARCHAR(10) NOT NULL,
    `reasoning` TEXT NOT NULL,
    `openedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `exitPrice` DOUBLE NULL,
    `pnlUsd` DOUBLE NULL,
    `rMultiple` DOUBLE NULL,
    `lastPrice` DOUBLE NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `scalp_paper_trades_status_idx`(`status`),
    INDEX `scalp_paper_trades_createdAt_idx`(`createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
