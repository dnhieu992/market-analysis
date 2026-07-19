-- CreateTable
CREATE TABLE `order_journals` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `kind` VARCHAR(8) NOT NULL DEFAULT 'manual',
    `content` LONGTEXT NOT NULL,
    `images` JSON NOT NULL,
    `snapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `order_journals_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
