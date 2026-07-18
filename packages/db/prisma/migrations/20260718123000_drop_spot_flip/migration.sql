-- Drop the Spot Flip feature tables. No foreign keys between them, so order is
-- not significant.
DROP TABLE IF EXISTS `spot_flip_log`;
DROP TABLE IF EXISTS `spot_flip_daily`;
DROP TABLE IF EXISTS `spot_flip_watch`;
