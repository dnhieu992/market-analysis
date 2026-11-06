-- /trades OKX short AI chat: action cards + versioned editable analysis skill.

-- CreateTable
CREATE TABLE `okx_ai_actions` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `messageId` CHAR(36) NULL,
    `type` VARCHAR(12) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL,
    `holdSide` VARCHAR(8) NOT NULL DEFAULT 'short',
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

    INDEX `okx_ai_actions_conversationId_idx`(`conversationId`),
    INDEX `okx_ai_actions_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_skill_versions` (
    `id` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(50) NOT NULL,
    `version` INTEGER NOT NULL,
    `content` LONGTEXT NOT NULL,
    `note` VARCHAR(500) NULL,
    `author` VARCHAR(8) NOT NULL DEFAULT 'USER',
    `conversationId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `chat_skill_versions_skillId_version_key`(`skillId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
