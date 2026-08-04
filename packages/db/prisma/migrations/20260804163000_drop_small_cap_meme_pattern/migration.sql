-- Drop the Small Cap Radar, Meme Radar and Pattern Scanner tables.
-- The three pages and all their API/worker code were removed on 2026-08-04.
-- Children first: the *_signals / *_signal_history tables carry an FK onto
-- their coin table with ON DELETE CASCADE, so they must go before the parent.

-- DropTable (Small Cap Radar)
DROP TABLE IF EXISTS `small_cap_signal_history`;
DROP TABLE IF EXISTS `small_cap_signals`;
DROP TABLE IF EXISTS `small_cap_coins`;

-- DropTable (Meme Radar)
DROP TABLE IF EXISTS `meme_signal_history`;
DROP TABLE IF EXISTS `meme_signals`;
DROP TABLE IF EXISTS `meme_coins`;

-- DropTable (Pattern Scanner)
DROP TABLE IF EXISTS `pattern_reference_images`;
DROP TABLE IF EXISTS `pattern_watch_coins`;
