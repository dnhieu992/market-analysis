-- Chat skill setups (Accept / Cancel) and the paper-trade fields they need:
-- pending LIMIT/STOP orders with an expiry, and a partial TP1 with break-even stop.

-- AlterTable
ALTER TABLE `strategy_paper_trades`
    ADD COLUMN `orderType` VARCHAR(8) NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `takeProfit1` DOUBLE NULL,
    ADD COLUMN `tp1HitAt` DATETIME(3) NULL,
    ADD COLUMN `realizedPnlUsd` DOUBLE NULL;

-- CreateTable
CREATE TABLE `skill_trade_setups` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `messageId` CHAR(36) NULL,
    `skillId` VARCHAR(50) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `direction` VARCHAR(5) NOT NULL,
    `orderType` VARCHAR(8) NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NOT NULL,
    `takeProfit1` DOUBLE NOT NULL,
    `takeProfit2` DOUBLE NULL,
    `setupType` VARCHAR(80) NULL,
    `confidence` VARCHAR(20) NULL,
    `note` TEXT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PROPOSED',
    `paperTradeId` VARCHAR(30) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `skill_trade_setups_conversationId_idx`(`conversationId`),
    INDEX `skill_trade_setups_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
