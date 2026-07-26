-- CreateTable
CREATE TABLE `tracking_coin_activity_logs` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `kind` VARCHAR(8) NOT NULL DEFAULT 'manual',
    `event` VARCHAR(16) NULL,
    `content` LONGTEXT NOT NULL,
    `images` JSON NOT NULL,
    `snapshot` JSON NULL,
    `refId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tracking_coin_activity_logs_refId_key`(`refId`),
    INDEX `tracking_coin_activity_logs_symbol_createdAt_idx`(`symbol`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- DropTable
-- The per-date coin journal was never used (0 rows in production) and its UI tab is
-- replaced by the activity log above.
DROP TABLE IF EXISTS `tracking_coin_journals`;
