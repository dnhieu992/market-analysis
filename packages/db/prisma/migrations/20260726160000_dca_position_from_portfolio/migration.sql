-- The DCA position is no longer stored separately: it IS the portfolio's Holding +
-- CoinTransaction rows for the coin, read through TrackingCoin.dcaPortfolioId. The
-- mirrored buy log and the 3-layer cap that went with it are gone.
--
-- Every surviving row in tracking_coin_dca_buys already carries a transactionId, so the
-- portfolio keeps the full position — nothing is lost by dropping the table.

-- DropTable
DROP TABLE IF EXISTS `tracking_coin_dca_buys`;

-- AlterTable
ALTER TABLE `tracking_coins` DROP COLUMN `dcaMaxLayers`;
