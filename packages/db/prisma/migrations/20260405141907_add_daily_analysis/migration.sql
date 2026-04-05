-- CreateTable
CREATE TABLE `DailyAnalysis` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `d1Trend` VARCHAR(191) NOT NULL,
    `h4Trend` VARCHAR(191) NOT NULL,
    `d1S1` DOUBLE NOT NULL,
    `d1S2` DOUBLE NOT NULL,
    `d1R1` DOUBLE NOT NULL,
    `d1R2` DOUBLE NOT NULL,
    `h4S1` DOUBLE NOT NULL,
    `h4S2` DOUBLE NOT NULL,
    `h4R1` DOUBLE NOT NULL,
    `h4R2` DOUBLE NOT NULL,
    `summary` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DailyAnalysis_symbol_date_idx`(`symbol`, `date`),
    UNIQUE INDEX `DailyAnalysis_symbol_date_key`(`symbol`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
