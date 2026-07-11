-- CreateTable
CREATE TABLE `spot_flip_watch` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL DEFAULT '',
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `spot_flip_watch_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the default watchlist (preserves the previous hard-coded preload set).
INSERT INTO `spot_flip_watch` (`id`, `symbol`, `name`) VALUES
    (UUID(), 'BTCUSDT', 'Bitcoin'),
    (UUID(), 'ETHUSDT', 'Ethereum'),
    (UUID(), 'SOLUSDT', 'Solana'),
    (UUID(), 'BNBUSDT', 'BNB'),
    (UUID(), 'XRPUSDT', 'XRP');
