-- CreateTable
CREATE TABLE `bitget_closed_positions` (
    `id` VARCHAR(191) NOT NULL,
    `positionId` VARCHAR(40) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL,
    `marginMode` VARCHAR(12) NOT NULL DEFAULT '',
    `openAvgPrice` DOUBLE NOT NULL,
    `closeAvgPrice` DOUBLE NOT NULL,
    `openTotalPos` DOUBLE NOT NULL,
    `netProfit` DOUBLE NOT NULL,
    `pnl` DOUBLE NOT NULL DEFAULT 0,
    `totalFunding` DOUBLE NOT NULL DEFAULT 0,
    `openFee` DOUBLE NOT NULL DEFAULT 0,
    `closeFee` DOUBLE NOT NULL DEFAULT 0,
    `openedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bitget_closed_positions_positionId_key`(`positionId`),
    INDEX `bitget_closed_positions_symbol_idx`(`symbol`),
    INDEX `bitget_closed_positions_closedAt_idx`(`closedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
