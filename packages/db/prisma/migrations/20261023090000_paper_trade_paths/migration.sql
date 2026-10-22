-- Minute-by-minute path of filled scalping-skill paper trades (data for picking a time stop).

-- CreateTable
CREATE TABLE `strategy_paper_trade_paths` (
    `tradeId` VARCHAR(30) NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `risk` DOUBLE NOT NULL,
    `direction` VARCHAR(5) NOT NULL,
    `closeR` JSON NOT NULL,
    `mfeR` DOUBLE NOT NULL DEFAULT 0,
    `maeR` DOUBLE NOT NULL DEFAULT 0,
    `mfeMin` INTEGER NULL,
    `maeMin` INTEGER NULL,
    `tp1Min` INTEGER NULL,
    `exitMin` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tradeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
