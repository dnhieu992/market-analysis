-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `images` JSON NOT NULL DEFAULT (JSON_ARRAY());
