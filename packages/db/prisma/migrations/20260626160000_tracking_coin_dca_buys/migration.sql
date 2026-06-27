-- CreateTable
CREATE TABLE `tracking_coin_dca_buys` (
    `id` VARCHAR(191) NOT NULL,
    `coinId` VARCHAR(191) NOT NULL,
    `price` DOUBLE NOT NULL,
    `usd` DOUBLE NOT NULL,
    `boughtAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tracking_coin_dca_buys_coinId_boughtAt_idx`(`coinId`, `boughtAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tracking_coin_dca_buys` ADD CONSTRAINT `tracking_coin_dca_buys_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `tracking_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
