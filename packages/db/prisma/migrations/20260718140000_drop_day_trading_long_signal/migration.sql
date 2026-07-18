-- Remove the day-trading and long-signal bots entirely (pages + code deleted).
-- Their reusable Bitget connect/action layer was extracted to shared modules;
-- these strategy/state tables are dropped.

-- DropTable
DROP TABLE IF EXISTS `day_trading_action_logs`;

-- DropTable
DROP TABLE IF EXISTS `day_trading_signals`;

-- DropTable
DROP TABLE IF EXISTS `day_trading_settings`;

-- DropTable
DROP TABLE IF EXISTS `long_signals`;

-- DropTable
DROP TABLE IF EXISTS `long_signal_settings`;
