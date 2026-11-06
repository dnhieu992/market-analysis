-- Backtests run from an AI chat ("/backtest …") in the Docker sandbox, plus the chat's write-up.

-- CreateTable
CREATE TABLE `backtest_runs` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` CHAR(36) NULL,
    `skillId` VARCHAR(50) NULL,
    `title` VARCHAR(200) NOT NULL,
    `status` VARCHAR(8) NOT NULL,
    `spec` JSON NOT NULL,
    `code` LONGTEXT NOT NULL,
    `stats` JSON NULL,
    `trades` JSON NULL,
    `logs` JSON NULL,
    `error` TEXT NULL,
    `durationMs` INTEGER NULL,
    `report` LONGTEXT NULL,
    `reportAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `backtest_runs_conversationId_idx`(`conversationId`),
    INDEX `backtest_runs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
