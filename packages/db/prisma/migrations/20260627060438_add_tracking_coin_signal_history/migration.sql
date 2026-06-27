-- CreateTable: append-only change log of the DCA signal (zone/bucket changes only)
CREATE TABLE `tracking_coin_signal_history` (
    `id` VARCHAR(191) NOT NULL,
    `coinId` VARCHAR(191) NOT NULL,
    `dcaScore` INTEGER NOT NULL,
    `dcaZone` VARCHAR(5) NULL,
    `dcaBucket` VARCHAR(6) NOT NULL,
    `trend` VARCHAR(15) NOT NULL DEFAULT 'Neutral',
    `weekTrend` VARCHAR(15) NOT NULL DEFAULT 'Neutral',
    `h4Trend` VARCHAR(15) NOT NULL DEFAULT 'Neutral',
    `rsi` DOUBLE NULL,
    `extPct` DOUBLE NULL,
    `price` DOUBLE NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tracking_coin_signal_history_coinId_scannedAt_idx`(`coinId`, `scannedAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tracking_coin_signal_history` ADD CONSTRAINT `tracking_coin_signal_history_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `tracking_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
