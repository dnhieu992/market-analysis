-- CreateTable
CREATE TABLE `ema_stoch_watch_coins` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL DEFAULT '',
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ema_stoch_watch_coins_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ema_stoch_signals` (
    `id` VARCHAR(191) NOT NULL,
    `coinId` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `triggeredAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `entryPrice` DOUBLE NOT NULL,
    `tpPrice` DOUBLE NOT NULL,
    `distPct` DOUBLE NOT NULL,
    `rsi` DOUBLE NULL,
    `stochK` DOUBLE NULL,
    `stochD` DOUBLE NULL,
    `ema34` DOUBLE NULL,
    `ema89` DOUBLE NULL,
    `ema200` DOUBLE NULL,
    `currentPrice` DOUBLE NULL,
    `pnlPct` DOUBLE NULL,
    `hitTpAt` DATETIME(3) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ema_stoch_signals_symbol_idx`(`symbol`),
    INDEX `ema_stoch_signals_status_idx`(`status`),
    UNIQUE INDEX `ema_stoch_signals_coinId_triggeredAt_key`(`coinId`, `triggeredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ema_stoch_signals` ADD CONSTRAINT `ema_stoch_signals_coinId_fkey` FOREIGN KEY (`coinId`) REFERENCES `ema_stoch_watch_coins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
