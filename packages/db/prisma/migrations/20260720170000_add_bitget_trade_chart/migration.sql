-- CreateTable
CREATE TABLE `bitget_trade_charts` (
    `id` VARCHAR(191) NOT NULL,
    `tradeKey` VARCHAR(90) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `timeframe` VARCHAR(8) NOT NULL,
    `url` TEXT NOT NULL,
    `objectKey` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bitget_trade_charts_symbol_idx`(`symbol`),
    UNIQUE INDEX `bitget_trade_charts_tradeKey_timeframe_key`(`tradeKey`, `timeframe`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
