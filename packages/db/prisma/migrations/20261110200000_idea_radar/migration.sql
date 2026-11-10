-- CreateTable
CREATE TABLE `idea_radar_runs` (
    `id` VARCHAR(191) NOT NULL,
    `runDate` VARCHAR(10) NOT NULL,
    `trigger` VARCHAR(8) NOT NULL,
    `dryRun` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(10) NOT NULL,
    `step` VARCHAR(40) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `errors` JSON NULL,
    `stats` JSON NULL,
    `reportMd` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `idea_radar_runs_runDate_key`(`runDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_apps` (
    `id` VARCHAR(191) NOT NULL,
    `store` VARCHAR(12) NOT NULL,
    `storeAppId` VARCHAR(200) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `developer` VARCHAR(300) NULL,
    `category` VARCHAR(100) NULL,
    `url` VARCHAR(500) NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `idea_radar_apps_store_storeAppId_key`(`store`, `storeAppId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_app_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `country` VARCHAR(4) NOT NULL,
    `chart` VARCHAR(10) NOT NULL,
    `category` VARCHAR(40) NOT NULL DEFAULT '',
    `rank` INTEGER NULL,
    `installs` DOUBLE NULL,
    `rating` DOUBLE NULL,
    `ratingCount` INTEGER NULL,
    `price` DOUBLE NULL,
    `hasAds` BOOLEAN NULL,
    `hasIap` BOOLEAN NULL,
    `updatedOn` DATETIME(3) NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idea_radar_app_snapshots_appId_idx`(`appId`),
    UNIQUE INDEX `idea_radar_app_snapshots_runId_appId_country_chart_category_key`(`runId`, `appId`, `country`, `chart`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_reviews` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `storeReviewId` VARCHAR(191) NOT NULL,
    `country` VARCHAR(4) NOT NULL,
    `rating` INTEGER NOT NULL,
    `title` VARCHAR(500) NULL,
    `body` TEXT NOT NULL,
    `reviewDate` DATETIME(3) NULL,
    `collectedRunId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `idea_radar_reviews_storeReviewId_key`(`storeReviewId`),
    INDEX `idea_radar_reviews_appId_reviewDate_idx`(`appId`, `reviewDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_posts` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(12) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `body` TEXT NULL,
    `url` VARCHAR(1000) NOT NULL,
    `score` INTEGER NULL,
    `numComments` INTEGER NULL,
    `postedAt` DATETIME(3) NOT NULL,
    `collectedRunId` VARCHAR(191) NOT NULL,
    `extra` JSON NULL,

    UNIQUE INDEX `idea_radar_posts_externalId_key`(`externalId`),
    INDEX `idea_radar_posts_postedAt_idx`(`postedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_pain_points` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NULL,
    `postIds` JSON NULL,
    `source` VARCHAR(8) NOT NULL,
    `summary` TEXT NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `frequency` INTEGER NOT NULL,
    `severity` INTEGER NOT NULL,
    `quotes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idea_radar_pain_points_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_trend_signals` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `signalType` VARCHAR(12) NOT NULL,
    `value` DOUBLE NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idea_radar_trend_signals_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_ideas` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `oneLiner` TEXT NOT NULL,
    `targetUsers` TEXT NOT NULL,
    `problem` TEXT NOT NULL,
    `solution` TEXT NOT NULL,
    `keyFeatures` JSON NOT NULL,
    `monetization` JSON NOT NULL,
    `competitors` JSON NOT NULL,
    `evidence` JSON NOT NULL,
    `scoreDemand` DOUBLE NOT NULL,
    `scoreCompetition` DOUBLE NOT NULL,
    `scoreMonetization` DOUBLE NOT NULL,
    `scoreEffort` DOUBLE NOT NULL,
    `scoreTotal` DOUBLE NOT NULL,
    `repeatOf` VARCHAR(300) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'new',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idea_radar_ideas_runId_idx`(`runId`),
    INDEX `idea_radar_ideas_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_llm_usages` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NULL,
    `step` VARCHAR(30) NOT NULL,
    `model` VARCHAR(60) NOT NULL,
    `inputTokens` INTEGER NOT NULL,
    `outputTokens` INTEGER NOT NULL,
    `costUsd` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idea_radar_llm_usages_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_radar_settings` (
    `id` VARCHAR(20) NOT NULL,
    `config` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `idea_radar_app_snapshots` ADD CONSTRAINT `idea_radar_app_snapshots_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `idea_radar_apps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_radar_app_snapshots` ADD CONSTRAINT `idea_radar_app_snapshots_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `idea_radar_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_radar_reviews` ADD CONSTRAINT `idea_radar_reviews_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `idea_radar_apps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_radar_pain_points` ADD CONSTRAINT `idea_radar_pain_points_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `idea_radar_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_radar_pain_points` ADD CONSTRAINT `idea_radar_pain_points_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `idea_radar_apps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_radar_trend_signals` ADD CONSTRAINT `idea_radar_trend_signals_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `idea_radar_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_radar_trend_signals` ADD CONSTRAINT `idea_radar_trend_signals_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `idea_radar_apps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_radar_ideas` ADD CONSTRAINT `idea_radar_ideas_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `idea_radar_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_radar_llm_usages` ADD CONSTRAINT `idea_radar_llm_usages_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `idea_radar_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

