-- CreateTable: append-only change log of the small-cap radar signal (stage changes only)
CREATE TABLE `small_cap_signal_history` (
    `id` VARCHAR(191) NOT NULL,
    `coinId` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(20) NOT NULL,
    `signalScore` INTEGER NOT NULL DEFAULT 0,
    `trend` VARCHAR(15) NOT NULL DEFAULT 'Neutral',
    `rsi` DOUBLE NULL,
    `volMultiplier` DOUBLE NULL,
    `extPct` DOUBLE NULL,
    `price` DOUBLE NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `small_cap_signal_history_coinId_scannedAt_idx`(`coinId`, `scannedAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `small_cap_signal_history` ADD CONSTRAINT `small_cap_signal_history_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `small_cap_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
