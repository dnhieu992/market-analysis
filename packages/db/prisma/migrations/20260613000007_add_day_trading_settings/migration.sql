-- CreateTable
CREATE TABLE `day_trading_settings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `riskPerTrade` DOUBLE NOT NULL DEFAULT 2,
    `minRR` DOUBLE NOT NULL DEFAULT 2,
    `maxTradesPerDay` INTEGER NOT NULL DEFAULT 5,
    `maxLossesPerDay` INTEGER NOT NULL DEFAULT 2,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
