-- CreateTable
CREATE TABLE `bitget_auto_trade_configs` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bitget_auto_trade_configs_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bitget_auto_trade_runs` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `tradeDate` VARCHAR(10) NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `entryPrice` DOUBLE NULL,
    `size` DOUBLE NULL,
    `leverage` INTEGER NULL,
    `marginUsd` DOUBLE NULL,
    `tpPrice` DOUBLE NULL,
    `exitReason` VARCHAR(24) NULL,
    `detail` TEXT NULL,
    `openedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bitget_auto_trade_runs_status_idx`(`status`),
    UNIQUE INDEX `bitget_auto_trade_runs_symbol_tradeDate_key`(`symbol`, `tradeDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
