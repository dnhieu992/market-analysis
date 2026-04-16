-- CreateTable
CREATE TABLE `portfolios` (
    `id` CHAR(36) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolios_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `id` CHAR(36) NOT NULL,
    `portfolioId` CHAR(36) NOT NULL,
    `coinId` VARCHAR(50) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `price` DECIMAL(20, 8) NOT NULL,
    `amount` DECIMAL(20, 8) NOT NULL,
    `totalValue` DECIMAL(20, 8) NOT NULL,
    `fee` DECIMAL(20, 8) NOT NULL DEFAULT 0,
    `note` TEXT NULL,
    `transactedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `transactions_portfolioId_coinId_idx`(`portfolioId`, `coinId`),
    INDEX `transactions_transactedAt_idx`(`transactedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holdings` (
    `id` CHAR(36) NOT NULL,
    `portfolioId` CHAR(36) NOT NULL,
    `coinId` VARCHAR(50) NOT NULL,
    `totalAmount` DECIMAL(20, 8) NOT NULL,
    `totalCost` DECIMAL(20, 8) NOT NULL,
    `avgCost` DECIMAL(20, 8) NOT NULL,
    `realizedPnl` DECIMAL(20, 8) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `holdings_portfolioId_coinId_key`(`portfolioId`, `coinId`),
    INDEX `holdings_portfolioId_idx`(`portfolioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pnl_history` (
    `id` CHAR(36) NOT NULL,
    `portfolioId` CHAR(36) NOT NULL,
    `coinId` VARCHAR(50) NULL,
    `date` DATE NOT NULL,
    `realizedPnl` DECIMAL(20, 8) NOT NULL,
    `unrealizedPnl` DECIMAL(20, 8) NOT NULL,
    `totalValue` DECIMAL(20, 8) NOT NULL,

    UNIQUE INDEX `pnl_history_portfolioId_coinId_date_key`(`portfolioId`, `coinId`, `date`),
    INDEX `pnl_history_portfolioId_date_idx`(`portfolioId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `portfolios` ADD CONSTRAINT `portfolios_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holdings` ADD CONSTRAINT `holdings_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pnl_history` ADD CONSTRAINT `pnl_history_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
