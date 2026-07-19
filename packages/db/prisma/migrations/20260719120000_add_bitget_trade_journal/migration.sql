-- CreateTable
CREATE TABLE `bitget_trade_journals` (
    `id` VARCHAR(191) NOT NULL,
    `tradeKey` VARCHAR(90) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `images` JSON NOT NULL,
    `snapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bitget_trade_journals_tradeKey_createdAt_idx`(`tradeKey`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
