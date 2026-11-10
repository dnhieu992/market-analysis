-- CreateTable
CREATE TABLE `chart_samples` (
    `id` VARCHAR(191) NOT NULL,
    `imageUrl` TEXT NOT NULL,
    `imageKey` VARCHAR(300) NULL,
    `symbol` VARCHAR(30) NULL,
    `interval` VARCHAR(5) NULL,
    `chartTime` DATETIME(3) NULL,
    `entryPrice` DOUBLE NULL,
    `direction` VARCHAR(5) NULL,
    `tpPct` DOUBLE NULL,
    `slPct` DOUBLE NULL,
    `note` TEXT NULL,
    `tags` JSON NULL,
    `aiRead` JSON NULL,
    `features` JSON NULL,
    `outcome` JSON NULL,
    `outcomeStatus` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `outcomeError` TEXT NULL,
    `conversationId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `chart_samples_symbol_idx`(`symbol`),
    INDEX `chart_samples_outcomeStatus_idx`(`outcomeStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
