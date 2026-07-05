-- CreateTable
CREATE TABLE `meme_coins` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL DEFAULT '',
    `marketCap` DOUBLE NULL,
    `listingDate` DATE NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `meme_coins_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meme_signals` (
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
    `extPct` DOUBLE NULL,
    `sparklineJson` TEXT NOT NULL,
    `trend` VARCHAR(15) NOT NULL DEFAULT 'Neutral',
    `swingStructure` VARCHAR(10) NOT NULL DEFAULT 'Mixed',
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `meme_signals_date_signalScore_idx`(`date`, `signalScore` DESC),
    UNIQUE INDEX `meme_signals_coinId_date_key`(`coinId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meme_signal_history` (
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

    INDEX `meme_signal_history_coinId_scannedAt_idx`(`coinId`, `scannedAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `meme_signals` ADD CONSTRAINT `meme_signals_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `meme_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meme_signal_history` ADD CONSTRAINT `meme_signal_history_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `meme_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
