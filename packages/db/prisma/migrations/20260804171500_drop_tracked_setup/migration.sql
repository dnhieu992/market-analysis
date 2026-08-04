-- Drop the tracked-setup table. The /tracked-setups and /daily-plan pages and
-- the worker setup-extraction / setup-tracking jobs were removed on 2026-08-04.
--
-- `DailyAnalysis` is deliberately NOT dropped: the worker still generates the
-- daily plan and sends it to Telegram, and it persists each run to that table.
-- TrackedSetup.dailyAnalysisId was a plain indexed column, not a real FK, so
-- there is no constraint to drop first.

-- DropTable
DROP TABLE IF EXISTS `TrackedSetup`;
