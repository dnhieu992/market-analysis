-- SHORT score snapshots of the /trades OKX chat (daily cron + on demand).

-- CreateTable
CREATE TABLE `short_score_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `takenAt` DATETIME(3) NOT NULL,
    `scorePct` DOUBLE NOT NULL,
    `hitPoints` DOUBLE NOT NULL,
    `maxPoints` DOUBLE NOT NULL,
    `criteriaVersion` INTEGER NOT NULL,
    `price` DOUBLE NULL,
    `results` JSON NOT NULL,
    `trigger` VARCHAR(8) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `short_score_snapshots_symbol_takenAt_idx`(`symbol`, `takenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
