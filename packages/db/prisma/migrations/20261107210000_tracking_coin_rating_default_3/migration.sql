-- Spot Analytic: every coin starts at 3 stars (user request 2026-11-07).
ALTER TABLE `tracking_coins` ALTER COLUMN `rating` SET DEFAULT 3;
UPDATE `tracking_coins` SET `rating` = 3 WHERE `rating` = 0;
