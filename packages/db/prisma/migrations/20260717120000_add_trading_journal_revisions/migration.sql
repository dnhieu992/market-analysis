-- CreateTable
CREATE TABLE `trading_journal_revisions` (
    `id` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `images` JSON NOT NULL,
    `tags` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `trading_journal_revisions_entryId_createdAt_idx`(`entryId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `trading_journal_revisions` ADD CONSTRAINT `trading_journal_revisions_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `trading_journal_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill one revision per existing day, timestamped at that day's last save, so days
-- written before this feature still show a baseline in the history panel.
INSERT INTO `trading_journal_revisions` (`id`, `entryId`, `content`, `images`, `tags`, `createdAt`)
SELECT UUID(), `id`, `content`, `images`, `tags`, `updatedAt` FROM `trading_journal_entries`;
