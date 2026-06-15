-- AlterTable: pullback scale-in add-on support for swing trading.
-- legKind distinguishes the base leg from scale-in legs; pullbackArmed tracks the
-- re-arm state (price must move >band away from the UTBot line before the next add).
ALTER TABLE `swing_trading_signals` ADD COLUMN `legKind` VARCHAR(10) NOT NULL DEFAULT 'BASE';
ALTER TABLE `swing_trading_signals` ADD COLUMN `pullbackArmed` BOOLEAN NOT NULL DEFAULT false;
