-- DropForeignKey
ALTER TABLE `top_cap_signals` DROP FOREIGN KEY `top_cap_signals_coinId_fkey`;

-- DropTable
DROP TABLE `top_cap_signals`;

-- DropTable
DROP TABLE `top_cap_coins`;
