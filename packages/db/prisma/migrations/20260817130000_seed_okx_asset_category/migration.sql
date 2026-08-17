-- Seed the OKX bucket so /okx has a capital baseline and /my-asset can value it
-- as a deployed account. The 2026-08-05 seed predates the OKX dashboard, so this
-- row only existed where it was created by hand.
--
-- Same idempotent form as that seed: a re-run, or a row already created on the
-- server, is a no-op rather than a duplicate-key failure.
INSERT INTO `asset_categories` (`id`, `key`, `label`, `sortOrder`, `createdAt`, `updatedAt`)
VALUES
    ('asset_cat_okx', 'okx', 'OKX', 6, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `key` = `asset_categories`.`key`;
