-- CreateTable
CREATE TABLE `AnalysisRun` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `timeframe` VARCHAR(191) NOT NULL,
    `candleOpenTime` DATETIME(3) NOT NULL,
    `candleCloseTime` DATETIME(3) NOT NULL,
    `priceOpen` DOUBLE NOT NULL,
    `priceHigh` DOUBLE NOT NULL,
    `priceLow` DOUBLE NOT NULL,
    `priceClose` DOUBLE NOT NULL,
    `rawIndicatorsJson` VARCHAR(191) NOT NULL,
    `llmInputJson` VARCHAR(191) NOT NULL,
    `llmOutputJson` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AnalysisRun_symbol_timeframe_candleCloseTime_idx`(`symbol`, `timeframe`, `candleCloseTime`),
    UNIQUE INDEX `AnalysisRun_symbol_timeframe_candleCloseTime_key`(`symbol`, `timeframe`, `candleCloseTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Signal` (
    `id` VARCHAR(191) NOT NULL,
    `analysisRunId` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `timeframe` VARCHAR(191) NOT NULL,
    `trend` VARCHAR(191) NOT NULL,
    `bias` VARCHAR(191) NOT NULL,
    `confidence` INTEGER NOT NULL,
    `summary` VARCHAR(191) NOT NULL,
    `supportLevelsJson` VARCHAR(191) NOT NULL,
    `resistanceLevelsJson` VARCHAR(191) NOT NULL,
    `invalidation` VARCHAR(191) NOT NULL,
    `bullishScenario` VARCHAR(191) NOT NULL,
    `bearishScenario` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Signal_analysisRunId_key`(`analysisRunId`),
    INDEX `Signal_symbol_timeframe_createdAt_idx`(`symbol`, `timeframe`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `signalId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `side` VARCHAR(191) NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `stopLoss` DOUBLE NULL,
    `takeProfit` DOUBLE NULL,
    `quantity` DOUBLE NULL,
    `leverage` DOUBLE NULL,
    `exchange` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `openedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `closePrice` DOUBLE NULL,
    `pnl` DOUBLE NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Order_symbol_status_openedAt_idx`(`symbol`, `status`, `openedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TelegramMessageLog` (
    `id` VARCHAR(191) NOT NULL,
    `analysisRunId` VARCHAR(191) NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `messageType` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `errorMessage` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Signal` ADD CONSTRAINT `Signal_analysisRunId_fkey` FOREIGN KEY (`analysisRunId`) REFERENCES `AnalysisRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_signalId_fkey` FOREIGN KEY (`signalId`) REFERENCES `Signal`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TelegramMessageLog` ADD CONSTRAINT `TelegramMessageLog_analysisRunId_fkey` FOREIGN KEY (`analysisRunId`) REFERENCES `AnalysisRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
