-- CreateTable
CREATE TABLE `mexc_trades` (
    `id` VARCHAR(191) NOT NULL,
    `tradeKey` VARCHAR(90) NOT NULL,
    `positionId` VARCHAR(40) NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'open',
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL,
    `marginMode` VARCHAR(12) NOT NULL DEFAULT '',
    `openAvgPrice` DOUBLE NOT NULL,
    `openTotalPos` DOUBLE NOT NULL,
    `leverage` DOUBLE NULL,
    `openedAt` DATETIME(3) NOT NULL,
    `closeAvgPrice` DOUBLE NULL,
    `netProfit` DOUBLE NULL,
    `pnl` DOUBLE NULL,
    `totalFunding` DOUBLE NULL,
    `openFee` DOUBLE NULL,
    `closeFee` DOUBLE NULL,
    `closedAt` DATETIME(3) NULL,
    `peakRoePct` INTEGER NULL,
    `troughRoePct` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mexc_trades_tradeKey_key`(`tradeKey`),
    UNIQUE INDEX `mexc_trades_positionId_key`(`positionId`),
    INDEX `mexc_trades_symbol_idx`(`symbol`),
    INDEX `mexc_trades_status_idx`(`status`),
    INDEX `mexc_trades_closedAt_idx`(`closedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mexc_sync_state` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `historyStartAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mexc_trade_journals` (
    `id` VARCHAR(191) NOT NULL,
    `tradeKey` VARCHAR(90) NOT NULL,
    `kind` VARCHAR(8) NOT NULL DEFAULT 'manual',
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `images` JSON NOT NULL,
    `snapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mexc_trade_journals_tradeKey_createdAt_idx`(`tradeKey`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mexc_setup_configs` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL,
    `leverage` INTEGER NOT NULL DEFAULT 10,
    `marginUsd` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mexc_setup_configs_symbol_holdSide_key`(`symbol`, `holdSide`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mexc_symbol_priorities` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mexc_symbol_priorities_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mexc_trade_charts` (
    `id` VARCHAR(191) NOT NULL,
    `tradeKey` VARCHAR(90) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `timeframe` VARCHAR(8) NOT NULL,
    `url` TEXT NOT NULL,
    `objectKey` VARCHAR(255) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mexc_trade_charts_tradeKey_timeframe_key`(`tradeKey`, `timeframe`),
    INDEX `mexc_trade_charts_symbol_idx`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
