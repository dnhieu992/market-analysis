-- CreateTable
CREATE TABLE `dca_configs` (
    `id` CHAR(36) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `coin` VARCHAR(10) NOT NULL,
    `totalBudget` DECIMAL(20, 8) NOT NULL,
    `portfolioId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `dca_configs_userId_idx`(`userId`),
    UNIQUE INDEX `dca_configs_userId_coin_key`(`userId`, `coin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dca_plans` (
    `id` CHAR(36) NOT NULL,
    `dcaConfigId` CHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `llmAnalysis` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `archivedAt` DATETIME(3) NULL,

    INDEX `dca_plans_dcaConfigId_status_idx`(`dcaConfigId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dca_plan_items` (
    `id` CHAR(36) NOT NULL,
    `dcaPlanId` CHAR(36) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `targetPrice` DECIMAL(20, 8) NOT NULL,
    `suggestedAmount` DECIMAL(20, 8) NOT NULL,
    `note` TEXT NULL,
    `source` VARCHAR(10) NOT NULL,
    `userModified` BOOLEAN NOT NULL DEFAULT false,
    `originalTargetPrice` DECIMAL(20, 8) NULL,
    `originalSuggestedAmount` DECIMAL(20, 8) NULL,
    `deletedByUser` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `executedPrice` DECIMAL(20, 8) NULL,
    `executedAmount` DECIMAL(20, 8) NULL,
    `executedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dca_plan_items_dcaPlanId_status_idx`(`dcaPlanId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dca_configs` ADD CONSTRAINT `dca_configs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dca_configs` ADD CONSTRAINT `dca_configs_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dca_plans` ADD CONSTRAINT `dca_plans_dcaConfigId_fkey` FOREIGN KEY (`dcaConfigId`) REFERENCES `dca_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dca_plan_items` ADD CONSTRAINT `dca_plan_items_dcaPlanId_fkey` FOREIGN KEY (`dcaPlanId`) REFERENCES `dca_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
