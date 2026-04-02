-- AlterTable
ALTER TABLE `AnalysisRun` MODIFY `rawIndicatorsJson` TEXT NOT NULL,
    MODIFY `llmInputJson` TEXT NOT NULL,
    MODIFY `llmOutputJson` TEXT NOT NULL,
    MODIFY `errorMessage` TEXT NULL;

-- AlterTable
ALTER TABLE `Order` MODIFY `note` TEXT NULL;

-- AlterTable
ALTER TABLE `Signal` MODIFY `summary` TEXT NOT NULL,
    MODIFY `supportLevelsJson` TEXT NOT NULL,
    MODIFY `resistanceLevelsJson` TEXT NOT NULL,
    MODIFY `invalidation` TEXT NOT NULL,
    MODIFY `bullishScenario` TEXT NOT NULL,
    MODIFY `bearishScenario` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `TelegramMessageLog` MODIFY `content` TEXT NOT NULL,
    MODIFY `errorMessage` TEXT NULL;
