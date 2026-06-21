-- CreateTable
CREATE TABLE `long_signals` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `direction` VARCHAR(5) NOT NULL DEFAULT 'LONG',
    `entryPrice` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `takeProfit` DOUBLE NOT NULL,
    `keyValue` DOUBLE NOT NULL DEFAULT 1,
    `entryLineDistancePct` DOUBLE NULL,
    `quantity` DOUBLE NULL,
    `positionValue` DOUBLE NULL,
    `status` VARCHAR(20) NOT NULL,
    `mode` VARCHAR(10) NOT NULL DEFAULT 'PAPER',
    `brokerOrderId` VARCHAR(64) NULL,
    `closedPrice` DOUBLE NULL,
    `closedAt` DATETIME(3) NULL,
    `pnlUsd` DOUBLE NULL,
    `setupJson` TEXT NOT NULL,
    `note` TEXT NULL,
    `detectedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `long_signals_symbol_status_detectedAt_idx`(`symbol`, `status`, `detectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `long_signal_settings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `notional` DOUBLE NOT NULL DEFAULT 100,
    `keyValue` DOUBLE NOT NULL DEFAULT 1,
    `atrPeriod` INTEGER NOT NULL DEFAULT 10,
    `tpPct` DOUBLE NOT NULL DEFAULT 2,
    `catastropheStopPct` DOUBLE NOT NULL DEFAULT 5,
    `entryHour` INTEGER NOT NULL DEFAULT 0,
    `exitHour` INTEGER NOT NULL DEFAULT 8,
    `leverage` INTEGER NOT NULL DEFAULT 5,
    `symbols` VARCHAR(255) NOT NULL DEFAULT 'POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT',
    `mode` VARCHAR(10) NOT NULL DEFAULT 'PAPER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
