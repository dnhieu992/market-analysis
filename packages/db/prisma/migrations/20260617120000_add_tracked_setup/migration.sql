-- CreateTable: tracked trade setups extracted from daily plans, updated by the
-- hourly tracking job (ENTERED / TP / SL) and the daily review (INVALID / EXPIRED).
CREATE TABLE `TrackedSetup` (
    `id` VARCHAR(191) NOT NULL,
    `dailyAnalysisId` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `planDate` DATE NOT NULL,
    `slot` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `entryLow` DOUBLE NOT NULL,
    `entryHigh` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `takeProfit1` DOUBLE NULL,
    `takeProfit2` DOUBLE NULL,
    `rawJson` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `enteredAt` DATETIME(3) NULL,
    `tp1HitAt` DATETIME(3) NULL,
    `tp2HitAt` DATETIME(3) NULL,
    `slHitAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `invalidatedReason` TEXT NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastPrice` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TrackedSetup_dailyAnalysisId_idx`(`dailyAnalysisId`),
    INDEX `TrackedSetup_symbol_planDate_idx`(`symbol`, `planDate`),
    INDEX `TrackedSetup_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
