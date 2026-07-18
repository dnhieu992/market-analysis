-- Drop the BTC DCA Ladder feature tables. `dca_orders` is dropped first because
-- it holds a foreign key to `dca_cycles`.
DROP TABLE IF EXISTS `dca_orders`;
DROP TABLE IF EXISTS `dca_cycles`;
DROP TABLE IF EXISTS `dca_ladder_settings`;
