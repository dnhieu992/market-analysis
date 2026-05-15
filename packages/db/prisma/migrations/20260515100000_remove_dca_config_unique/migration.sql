-- AlterTable: remove unique index on (userId, coin) to allow multiple DCA configs per coin
ALTER TABLE `dca_configs` DROP INDEX `dca_configs_userId_coin_key`;
