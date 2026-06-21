-- Lower the default per-order notional to $50 (5x leverage → ~$10 margin).
ALTER TABLE `long_signal_settings` ALTER COLUMN `notional` SET DEFAULT 50;

-- Bring the existing singleton down to the new default if it was never customised.
UPDATE `long_signal_settings` SET `notional` = 50 WHERE `id` = 'singleton' AND `notional` = 100;
