-- Tracking-coins swing setups (paper): setups, timeline events, lesson batches, config.
-- Drops the old scanner tables (signals, signal history, orders); a dump is kept in ~/backups.

-- DropForeignKey
ALTER TABLE `tracking_coin_orders` DROP FOREIGN KEY `tracking_coin_orders_coinId_fkey`;

-- DropForeignKey
ALTER TABLE `tracking_coin_signal_history` DROP FOREIGN KEY `tracking_coin_signal_history_coinId_fkey`;

-- DropForeignKey
ALTER TABLE `tracking_coin_signals` DROP FOREIGN KEY `tracking_coin_signals_coinId_fkey`;

-- DropTable
DROP TABLE `tracking_coin_orders`;

-- DropTable
DROP TABLE `tracking_coin_signal_history`;

-- DropTable
DROP TABLE `tracking_coin_signals`;

-- CreateTable
CREATE TABLE `tracking_setups` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `source` VARCHAR(8) NOT NULL,
    `conversationId` CHAR(36) NULL,
    `messageId` CHAR(36) NULL,
    `direction` VARCHAR(5) NOT NULL,
    `orderType` VARCHAR(8) NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `setupType` VARCHAR(80) NULL,
    `timeframe` VARCHAR(6) NOT NULL DEFAULT '4h',
    `confidence` VARCHAR(20) NULL,
    `thesis` TEXT NULL,
    `triggerNote` TEXT NULL,
    `invalidation` TEXT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `targets` JSON NOT NULL,
    `riskUsd` DOUBLE NOT NULL DEFAULT 10,
    `fillPrice` DOUBLE NULL,
    `quantity` DOUBLE NULL,
    `remainingQty` DOUBLE NULL,
    `currentStop` DOUBLE NULL,
    `placedAt` DATETIME(3) NULL,
    `filledAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `closeReason` VARCHAR(12) NULL,
    `realizedPnlUsd` DOUBLE NULL,
    `rMultiple` DOUBLE NULL,
    `manualIntervention` BOOLEAN NOT NULL DEFAULT false,
    `lastPrice` DOUBLE NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `mfeR` DOUBLE NULL,
    `maeR` DOUBLE NULL,
    `mfeAt` DATETIME(3) NULL,
    `maeAt` DATETIME(3) NULL,
    `pathR` JSON NULL,
    `rating` INTEGER NULL,
    `reviewNote` TEXT NULL,
    `reviewedAt` DATETIME(3) NULL,
    `postMortem` LONGTEXT NULL,
    `postMortemAt` DATETIME(3) NULL,
    `lessonBatchId` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tracking_setups_symbol_status_idx`(`symbol`, `status`),
    INDEX `tracking_setups_status_idx`(`status`),
    INDEX `tracking_setups_conversationId_idx`(`conversationId`),
    INDEX `tracking_setups_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tracking_setup_events` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `setupId` VARCHAR(30) NULL,
    `type` VARCHAR(16) NOT NULL,
    `price` DOUBLE NULL,
    `message` TEXT NOT NULL,
    `data` JSON NULL,
    `images` JSON NULL,
    `chartUrl` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tracking_setup_events_symbol_createdAt_idx`(`symbol`, `createdAt`),
    INDEX `tracking_setup_events_setupId_createdAt_idx`(`setupId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tracking_lesson_batches` (
    `id` VARCHAR(191) NOT NULL,
    `tradeCount` INTEGER NOT NULL,
    `tradeIds` JSON NOT NULL,
    `stats` JSON NULL,
    `draft` LONGTEXT NOT NULL,
    `content` LONGTEXT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tracking_trade_config` (
    `id` VARCHAR(20) NOT NULL DEFAULT 'singleton',
    `riskUsd` DOUBLE NOT NULL DEFAULT 10,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
