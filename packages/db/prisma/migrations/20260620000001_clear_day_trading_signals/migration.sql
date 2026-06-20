-- One-time cleanup before going LIVE: wipe all existing PAPER signals so the
-- table starts clean for real broker orders. Action-log audit history is kept.
DELETE FROM `day_trading_signals`;
