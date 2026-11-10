-- One real run + one dry-run per day: a same-day dry-run must not overwrite the real report.
ALTER TABLE `idea_radar_runs`
  DROP INDEX `idea_radar_runs_runDate_key`,
  ADD UNIQUE INDEX `idea_radar_runs_runDate_dryRun_key`(`runDate`, `dryRun`);
