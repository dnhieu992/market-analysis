-- CreateTable
CREATE TABLE `compound_trades` (
    `id` CHAR(36) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `coinId` VARCHAR(50) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `amount` DECIMAL(20, 8) NOT NULL,
    `price` DECIMAL(20, 8) NOT NULL,
    `totalValue` DECIMAL(20, 8) NOT NULL,
    `fee` DECIMAL(20, 8) NOT NULL DEFAULT 0,
    `note` TEXT NULL,
    `tradedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `compound_trades_userId_coinId_idx`(`userId`, `coinId`),
    INDEX `compound_trades_tradedAt_idx`(`tradedAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `compound_trades` ADD CONSTRAINT `compound_trades_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
