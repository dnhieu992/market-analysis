-- CreateTable
CREATE TABLE `dca_ladder_settings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `symbol` VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    `startCapital` DOUBLE NOT NULL DEFAULT 1000,
    `firstTierPct` DOUBLE NOT NULL DEFAULT 5,
    `numTiers` INTEGER NOT NULL DEFAULT 10,
    `stepPct` DOUBLE NOT NULL DEFAULT 1.5,
    `tpPct` DOUBLE NOT NULL DEFAULT 10,
    `feePct` DOUBLE NOT NULL DEFAULT 0.05,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dca_ladder_settings_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dca_cycles` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `cycleNumber` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `peak` DOUBLE NOT NULL,
    `budget` DOUBLE NOT NULL,
    `avgCost` DOUBLE NULL,
    `positionSize` DOUBLE NULL,
    `tpPrice` DOUBLE NULL,
    `realizedPnl` DOUBLE NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `dca_cycles_symbol_status_idx`(`symbol`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dca_orders` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(4) NOT NULL,
    `tierIndex` INTEGER NULL,
    `plannedPrice` DOUBLE NOT NULL,
    `fillPrice` DOUBLE NULL,
    `usdAmount` DOUBLE NULL,
    `qty` DOUBLE NULL,
    `status` VARCHAR(16) NOT NULL,
    `filledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `dca_orders_cycleId_status_idx`(`cycleId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dca_orders` ADD CONSTRAINT `dca_orders_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `dca_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
