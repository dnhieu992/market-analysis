-- CreateTable
CREATE TABLE `trading_journal_entries` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `content` LONGTEXT NOT NULL,
    `images` JSON NOT NULL,
    `tags` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trading_journal_entries_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
