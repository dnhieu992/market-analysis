-- /ema-bounce (EMA-stack oversold StochRSI scanner) removed — drop its tables.
-- Signals reference the watchlist via FK, so the child table goes first.

-- DropTable
DROP TABLE IF EXISTS `ema_stoch_signals`;

-- DropTable
DROP TABLE IF EXISTS `ema_stoch_watch_coins`;
