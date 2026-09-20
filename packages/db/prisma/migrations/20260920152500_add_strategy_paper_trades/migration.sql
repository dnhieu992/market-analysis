-- PDH/PDL breakout day-trade paper-trading tables for the refactored
-- /trading-analysis page. Standalone tables (no FK to Order/Signal): this is a
-- monitoring/paper experiment written entirely by the hourly engine, not a live
-- trading pipeline. Both tables are empty at the time of this migration.

-- CreateTable
CREATE TABLE `strategy_paper_trades` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    `timeframe` VARCHAR(6) NOT NULL DEFAULT '1h',
    `tradeDate` VARCHAR(10) NOT NULL,
    `direction` VARCHAR(5) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `pdh` DOUBLE NOT NULL,
    `pdl` DOUBLE NOT NULL,
    `signalClose` DOUBLE NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `initialStopLoss` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `takeProfit` DOUBLE NOT NULL,
    `riskUsd` DOUBLE NOT NULL DEFAULT 10,
    `quantity` DOUBLE NOT NULL,
    `rrPlanned` DOUBLE NOT NULL DEFAULT 2,
    `openedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `exitPrice` DOUBLE NULL,
    `exitReason` VARCHAR(12) NULL,
    `pnlUsd` DOUBLE NULL,
    `rMultiple` DOUBLE NULL,
    `lastPrice` DOUBLE NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `feedbackRating` INTEGER NULL,
    `feedbackNote` TEXT NULL,
    `feedbackAt` DATETIME(3) NULL,
    `chartUrl` TEXT NULL,
    `chartObjectKey` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `strategy_paper_trades_tradeDate_direction_key`(`tradeDate`, `direction`),
    INDEX `strategy_paper_trades_status_idx`(`status`),
    INDEX `strategy_paper_trades_createdAt_idx`(`createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `strategy_paper_config` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'pdhl-btc',
    `name` VARCHAR(191) NOT NULL DEFAULT 'BTC — Phá đỉnh/đáy ngày hôm trước',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `symbol` VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    `timeframe` VARCHAR(6) NOT NULL DEFAULT '1h',
    `riskUsd` DOUBLE NOT NULL DEFAULT 10,
    `rrPlanned` DOUBLE NOT NULL DEFAULT 2,
    `docMarkdown` LONGTEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
