-- Add publish status and pipeline debug payload for daily analysis.
ALTER TABLE `DailyAnalysis`
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'WAIT',
  ADD COLUMN `pipelineDebugJson` LONGTEXT NULL;
