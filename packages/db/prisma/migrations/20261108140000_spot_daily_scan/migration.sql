-- CreateTable
CREATE TABLE `spot_daily_scans` (
    `id` VARCHAR(191) NOT NULL,
    `scanDate` VARCHAR(10) NOT NULL,
    `trigger` VARCHAR(8) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `spot_daily_scans_scanDate_key`(`scanDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
