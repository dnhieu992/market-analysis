-- CreateTable
CREATE TABLE `pattern_watch_coins` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL DEFAULT '',
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pattern_watch_coins_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
