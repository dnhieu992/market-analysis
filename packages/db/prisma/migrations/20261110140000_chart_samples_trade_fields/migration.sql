-- Chart Lab as a trade journal: entry zone, user-entered result + close date, several images.
ALTER TABLE `chart_samples`
  MODIFY `imageUrl` TEXT NULL,
  ADD COLUMN `images` JSON NULL,
  ADD COLUMN `entryPriceTo` DOUBLE NULL,
  ADD COLUMN `result` VARCHAR(4) NULL,
  ADD COLUMN `closedAt` DATETIME(3) NULL;
