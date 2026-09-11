-- Attach an entry-moment 15m chart snapshot to each scalp paper trade. The image
-- is rendered and uploaded to R2 right AFTER the position is recorded, so these
-- columns are always nullable (blank until the render lands, and null if it fails
-- or R2 is unconfigured — the trade itself never depends on the chart).

-- AlterTable
ALTER TABLE `scalp_paper_trades`
  ADD COLUMN `chartUrl` TEXT NULL,
  ADD COLUMN `chartObjectKey` VARCHAR(300) NULL;
