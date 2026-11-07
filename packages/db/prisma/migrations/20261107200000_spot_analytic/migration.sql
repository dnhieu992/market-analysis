-- AlterTable
ALTER TABLE `tracking_coins` ADD COLUMN `rating` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `spot_trades` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `side` VARCHAR(4) NOT NULL,
    `price` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `portfolioId` CHAR(36) NOT NULL,
    `transactedAt` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `conversationId` CHAR(36) NULL,
    `messageId` CHAR(36) NULL,
    `transactionId` CHAR(36) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `spot_trades_symbol_status_idx`(`symbol`, `status`),
    INDEX `spot_trades_conversationId_idx`(`conversationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
