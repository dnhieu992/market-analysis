-- CreateTable: unified Bitget trade lifecycle (open + closed)
CREATE TABLE `bitget_trades` (
    `id` VARCHAR(191) NOT NULL,
    `tradeKey` VARCHAR(90) NOT NULL,
    `positionId` VARCHAR(40) NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'open',
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL,
    `marginMode` VARCHAR(12) NOT NULL DEFAULT '',
    `openAvgPrice` DOUBLE NOT NULL,
    `openTotalPos` DOUBLE NOT NULL,
    `openedAt` DATETIME(3) NOT NULL,
    `closeAvgPrice` DOUBLE NULL,
    `netProfit` DOUBLE NULL,
    `pnl` DOUBLE NULL,
    `totalFunding` DOUBLE NULL,
    `openFee` DOUBLE NULL,
    `closeFee` DOUBLE NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bitget_trades_tradeKey_key`(`tradeKey`),
    UNIQUE INDEX `bitget_trades_positionId_key`(`positionId`),
    INDEX `bitget_trades_symbol_idx`(`symbol`),
    INDEX `bitget_trades_status_idx`(`status`),
    INDEX `bitget_trades_closedAt_idx`(`closedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Migrate existing closed positions into the unified table as status='closed'.
-- tradeKey is set to a guaranteed-unique legacy value (no journals exist for
-- these historical trades, so the exact key does not matter — only uniqueness).
INSERT INTO `bitget_trades` (
    `id`, `tradeKey`, `positionId`, `status`, `symbol`, `holdSide`, `marginMode`,
    `openAvgPrice`, `openTotalPos`, `openedAt`,
    `closeAvgPrice`, `netProfit`, `pnl`, `totalFunding`, `openFee`, `closeFee`, `closedAt`,
    `createdAt`, `updatedAt`
)
SELECT
    `id`, CONCAT('legacy-', `positionId`), `positionId`, 'closed', `symbol`, `holdSide`, `marginMode`,
    `openAvgPrice`, `openTotalPos`, `openedAt`,
    `closeAvgPrice`, `netProfit`, `pnl`, `totalFunding`, `openFee`, `closeFee`, `closedAt`,
    `createdAt`, `createdAt`
FROM `bitget_closed_positions`;

-- Drop the old closed-only table (data has been copied above).
DROP TABLE `bitget_closed_positions`;

-- AlterTable: distinguish trader notes from system lifecycle events on the journal.
ALTER TABLE `bitget_trade_journals` ADD COLUMN `kind` VARCHAR(8) NOT NULL DEFAULT 'manual';
