-- Action cards proposed by the /bitget AI chat; executed only after the user confirms.
-- CreateTable
CREATE TABLE `bitget_ai_actions` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `messageId` CHAR(36) NULL,
    `type` VARCHAR(12) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL,
    `params` JSON NOT NULL,
    `reason` TEXT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PROPOSED',
    `executedParams` JSON NULL,
    `result` JSON NULL,
    `orderId` VARCHAR(64) NULL,
    `error` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bitget_ai_actions_conversationId_idx`(`conversationId`),
    INDEX `bitget_ai_actions_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
