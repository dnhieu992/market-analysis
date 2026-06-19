-- CreateTable
CREATE TABLE `day_trading_action_logs` (
    `id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `signalId` VARCHAR(30) NULL,
    `symbol` VARCHAR(20) NULL,
    `message` TEXT NOT NULL,
    `detailJson` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `day_trading_action_logs_signalId_createdAt_idx`(`signalId`, `createdAt`),
    INDEX `day_trading_action_logs_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
