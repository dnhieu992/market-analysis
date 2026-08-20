-- Drop everything the /okx dashboard owned. The page, its API module, the worker
-- sync jobs and the `okx` bucket on /my-asset were removed on 2026-08-20, so
-- these tables have no reader left.
--
-- The `okx` asset category is deleted too: it held 0 USDT and no
-- `asset_transactions` row ever referenced it (the bucket was seeded but never
-- funded), so removing it changes no balance on /my-asset.

-- DropTable
DROP TABLE IF EXISTS `okx_trade_charts`;
DROP TABLE IF EXISTS `okx_trade_journals`;
DROP TABLE IF EXISTS `okx_setup_configs`;
DROP TABLE IF EXISTS `okx_symbol_priorities`;
DROP TABLE IF EXISTS `okx_watchlist_symbols`;
DROP TABLE IF EXISTS `okx_sync_state`;
DROP TABLE IF EXISTS `okx_trades`;

-- Remove the (empty, unreferenced) OKX capital bucket. Guarded on both sides:
-- the sub-select is a no-op if a transaction ever pointed at it.
DELETE FROM `asset_categories`
WHERE `key` = 'okx'
  AND `id` NOT IN (SELECT `fromCategoryId` FROM (SELECT `fromCategoryId` FROM `asset_transactions` WHERE `fromCategoryId` IS NOT NULL) AS f)
  AND `id` NOT IN (SELECT `toCategoryId` FROM (SELECT `toCategoryId` FROM `asset_transactions` WHERE `toCategoryId` IS NOT NULL) AS t);
