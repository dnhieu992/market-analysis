-- CreateTable
CREATE TABLE `spot_flip_daily` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `date` DATE NOT NULL,
    `price` DOUBLE NOT NULL,
    `upPct` DOUBLE NOT NULL,
    `downPct` DOUBLE NOT NULL,
    `pullbackPct` DOUBLE NOT NULL,
    `reboundPct` DOUBLE NOT NULL,
    `atrPct` DOUBLE NOT NULL,
    `high30d` DOUBLE NOT NULL,
    `low30d` DOUBLE NOT NULL,
    `changeH24` DOUBLE NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `spot_flip_daily_symbol_idx`(`symbol`),
    UNIQUE INDEX `spot_flip_daily_symbol_date_key`(`symbol`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
