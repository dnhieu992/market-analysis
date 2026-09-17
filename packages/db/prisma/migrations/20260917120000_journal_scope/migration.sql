-- AlterTable: add corpus discriminator, defaulting existing rows to the general /journal
ALTER TABLE `trading_journal_entries` ADD COLUMN `scope` VARCHAR(24) NOT NULL DEFAULT 'GENERAL';

-- Replace the day-only uniqueness with (scope, date): one entry per scope per calendar day
DROP INDEX `trading_journal_entries_date_key` ON `trading_journal_entries`;
CREATE UNIQUE INDEX `trading_journal_entries_scope_date_key` ON `trading_journal_entries`(`scope`, `date`);
