-- AlterTable
ALTER TABLE `users` ADD COLUMN `dailySignalWatchlist` JSON NOT NULL DEFAULT ('[]');
