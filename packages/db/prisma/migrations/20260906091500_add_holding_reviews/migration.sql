-- CreateTable
CREATE TABLE `holding_reviews` (
    `id` CHAR(36) NOT NULL,
    `portfolioId` CHAR(36) NOT NULL,
    `coinId` VARCHAR(50) NOT NULL,
    `reviewDate` DATE NOT NULL,
    `verdict` VARCHAR(32) NOT NULL,
    `previousVerdict` VARCHAR(32) NULL,
    `price` DECIMAL(20, 8) NULL,
    `reason` TEXT NULL,
    `metricsJson` TEXT NULL,
    `buyZonesJson` TEXT NULL,
    `sellZonesJson` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `holding_reviews_portfolioId_coinId_reviewDate_key`(`portfolioId`, `coinId`, `reviewDate`),
    INDEX `holding_reviews_portfolioId_reviewDate_idx`(`portfolioId`, `reviewDate` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `holding_reviews` ADD CONSTRAINT `holding_reviews_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
