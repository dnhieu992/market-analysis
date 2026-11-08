-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `dedupeKey` VARCHAR(120) NOT NULL,
    `exchange` VARCHAR(10) NULL,
    `symbol` VARCHAR(30) NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `payload` JSON NULL,
    `eventAt` DATETIME(3) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `telegramSent` BOOLEAN NOT NULL DEFAULT false,
    `telegramTries` INTEGER NOT NULL DEFAULT 0,
    `telegramError` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notifications_dedupeKey_key`(`dedupeKey`),
    INDEX `notifications_eventAt_idx`(`eventAt`),
    INDEX `notifications_readAt_idx`(`readAt`),
    INDEX `notifications_telegramSent_createdAt_idx`(`telegramSent`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_sync_state` (
    `id` VARCHAR(40) NOT NULL,
    `cursorAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
