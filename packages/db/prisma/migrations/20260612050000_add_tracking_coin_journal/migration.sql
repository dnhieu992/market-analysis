-- CreateTable
CREATE TABLE `tracking_coin_journals` (
    `id` VARCHAR(191) NOT NULL,
    `coinId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `content` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tracking_coin_journals_coinId_date_key`(`coinId`, `date`),
    INDEX `tracking_coin_journals_coinId_date_idx`(`coinId`, `date` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tracking_coin_journals` ADD CONSTRAINT `tracking_coin_journals_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `tracking_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
