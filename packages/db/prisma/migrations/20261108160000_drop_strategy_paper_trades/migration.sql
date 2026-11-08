-- /trading-analysis (strategy paper trades) removed. Backup: /root/backups/paper-trades-20261108.sql
DROP TABLE IF EXISTS `strategy_paper_trades`;
DROP TABLE IF EXISTS `strategy_paper_trade_paths`;
DROP TABLE IF EXISTS `strategy_paper_config`;
DROP TABLE IF EXISTS `strategy_paper_notes`;
ALTER TABLE `skill_trade_setups` DROP COLUMN `paperTradeId`;
