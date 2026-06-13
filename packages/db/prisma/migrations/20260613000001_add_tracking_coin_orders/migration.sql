-- CreateTable
CREATE TABLE `tracking_coin_orders` (
    `id` VARCHAR(191) NOT NULL,
    `coinId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `type` VARCHAR(15) NOT NULL,
    `side` VARCHAR(5) NOT NULL,
    `entryLow` DOUBLE NOT NULL,
    `entryHigh` DOUBLE NOT NULL,
    `tp1` DOUBLE NOT NULL,
    `tp2` DOUBLE NULL,
    `sl` DOUBLE NOT NULL,
    `rrRatio` DOUBLE NOT NULL,
    `rationale` TEXT NOT NULL,
    `activated` BOOLEAN NULL,
    `outcome` VARCHAR(5) NULL,
    `evaluatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tracking_coin_orders_coinId_date_type_key`(`coinId`, `date`, `type`),
    INDEX `tracking_coin_orders_coinId_date_idx`(`coinId`, `date` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tracking_coin_orders` ADD CONSTRAINT `tracking_coin_orders_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `tracking_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
