-- CreateTable
CREATE TABLE `asset_categories` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(30) NOT NULL,
    `label` VARCHAR(60) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `asset_categories_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `amountUsdt` DECIMAL(20, 8) NOT NULL,
    `fromCategoryId` VARCHAR(191) NULL,
    `toCategoryId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `asset_transactions_occurredAt_idx`(`occurredAt` DESC),
    INDEX `asset_transactions_fromCategoryId_idx`(`fromCategoryId`),
    INDEX `asset_transactions_toCategoryId_idx`(`toCategoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `asset_transactions` ADD CONSTRAINT `asset_transactions_fromCategoryId_fkey` FOREIGN KEY (`fromCategoryId`) REFERENCES `asset_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_transactions` ADD CONSTRAINT `asset_transactions_toCategoryId_fkey` FOREIGN KEY (`toCategoryId`) REFERENCES `asset_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the default buckets. Idempotent so a re-run (or a hand-created row) is a
-- no-op instead of a duplicate-key failure.
INSERT INTO `asset_categories` (`id`, `key`, `label`, `sortOrder`, `createdAt`, `updatedAt`)
VALUES
    ('asset_cat_spot', 'spot', 'Spot', 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('asset_cat_trading', 'trading', 'Trading', 2, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('asset_cat_bitget', 'bitget', 'Bitget', 3, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('asset_cat_mexc', 'mexc', 'MEXC', 4, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('asset_cat_wallet', 'wallet', 'Wallet', 5, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `key` = `asset_categories`.`key`;
