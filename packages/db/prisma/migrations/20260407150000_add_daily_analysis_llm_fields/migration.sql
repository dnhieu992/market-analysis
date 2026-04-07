-- AlterTable
ALTER TABLE `DailyAnalysis`
    ADD COLUMN `llmProvider` VARCHAR(191) NOT NULL DEFAULT 'claude',
    ADD COLUMN `llmModel` VARCHAR(191) NOT NULL DEFAULT 'sonnet',
    ADD COLUMN `aiOutputJson` TEXT NOT NULL;
