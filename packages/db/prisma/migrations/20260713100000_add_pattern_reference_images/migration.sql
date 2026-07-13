-- CreateTable
CREATE TABLE `pattern_reference_images` (
    `id` VARCHAR(191) NOT NULL,
    `pattern` VARCHAR(30) NOT NULL,
    `imageUrl` TEXT NOT NULL,
    `r2Key` VARCHAR(500) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pattern_reference_images_pattern_idx`(`pattern`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
