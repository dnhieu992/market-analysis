-- CreateTable
CREATE TABLE `small_cap_coins` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL DEFAULT '',
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `small_cap_coins_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `small_cap_signals` (
    `id` VARCHAR(191) NOT NULL,
    `coinId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `rsi` DOUBLE NULL,
    `volMultiplier` DOUBLE NULL,
    `ema34Above` BOOLEAN NOT NULL DEFAULT false,
    `ema89Above` BOOLEAN NOT NULL DEFAULT false,
    `ema200Above` BOOLEAN NOT NULL DEFAULT false,
    `stage` VARCHAR(20) NOT NULL DEFAULT 'Quiet',
    `signalScore` INTEGER NOT NULL DEFAULT 0,
    `sparklineJson` TEXT NOT NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `small_cap_signals_coinId_date_key`(`coinId`, `date`),
    INDEX `small_cap_signals_date_signalScore_idx`(`date`, `signalScore` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `small_cap_signals` ADD CONSTRAINT `small_cap_signals_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `small_cap_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
