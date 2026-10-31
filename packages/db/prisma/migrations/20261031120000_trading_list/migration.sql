-- /trading-list: star priority, assessment and hand-added coins shared by Bitget + MEXC.
-- CreateTable
CREATE TABLE `trading_list_priorities` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trading_list_priorities_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trading_list_notes` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `note` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trading_list_notes_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trading_list_watchlist_symbols` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `trading_list_watchlist_symbols_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed (read-only on the source tables). Stars: Bitget wins whenever it has a rating
-- (> 0); MEXC fills the coins Bitget never rated.
INSERT INTO `trading_list_priorities` (`id`, `symbol`, `priority`, `createdAt`, `updatedAt`)
SELECT `id`, `symbol`, `priority`, `createdAt`, CURRENT_TIMESTAMP(3)
FROM `bitget_symbol_priorities` WHERE `priority` > 0;

INSERT INTO `trading_list_priorities` (`id`, `symbol`, `priority`, `createdAt`, `updatedAt`)
SELECT m.`id`, m.`symbol`, m.`priority`, m.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `mexc_symbol_priorities` m
WHERE m.`priority` > 0
  AND NOT EXISTS (SELECT 1 FROM `trading_list_priorities` t WHERE t.`symbol` = m.`symbol`);

-- Notes: only /bitget keeps them.
INSERT INTO `trading_list_notes` (`id`, `symbol`, `note`, `createdAt`, `updatedAt`)
SELECT `id`, `symbol`, `note`, `createdAt`, CURRENT_TIMESTAMP(3) FROM `bitget_symbol_notes`;

-- Hand-added coins: only /mexc has them (Bitget's watchlist is hardcoded in the web app).
INSERT INTO `trading_list_watchlist_symbols` (`id`, `symbol`, `createdAt`)
SELECT `id`, `symbol`, `createdAt` FROM `mexc_watchlist_symbols`;
