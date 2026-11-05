-- /trading-list: one table holds every coin of the Setup table (was pins + hard-coded list + hand-added + trade history).

-- AlterTable
ALTER TABLE `trading_list_watchlist_symbols`
  ADD COLUMN `onlyExchange` VARCHAR(10) NULL,
  ADD COLUMN `exchangesCheckedAt` DATETIME(3) NULL;

-- Seed 1: the pins + the list that used to be hard-coded in the web app, in their old display order
-- (createdAt drives the order, so they sit before the hand-added coins).
INSERT IGNORE INTO `trading_list_watchlist_symbols` (`id`, `symbol`, `createdAt`) VALUES
  (CONCAT('tlw', MD5('BTCUSDT')),   'BTCUSDT',   '2000-01-01 00:00:00.000'),
  (CONCAT('tlw', MD5('ETHUSDT')),   'ETHUSDT',   '2000-01-01 00:00:01.000'),
  (CONCAT('tlw', MD5('SOLUSDT')),   'SOLUSDT',   '2000-01-01 00:00:02.000'),
  (CONCAT('tlw', MD5('XRPUSDT')),   'XRPUSDT',   '2000-01-01 00:00:03.000'),
  (CONCAT('tlw', MD5('SHIBUSDT')),  'SHIBUSDT',  '2000-01-01 00:00:04.000'),
  (CONCAT('tlw', MD5('PEPEUSDT')),  'PEPEUSDT',  '2000-01-01 00:00:05.000'),
  (CONCAT('tlw', MD5('WLDUSDT')),   'WLDUSDT',   '2000-01-01 00:00:06.000'),
  (CONCAT('tlw', MD5('BCHUSDT')),   'BCHUSDT',   '2000-01-01 00:00:07.000'),
  (CONCAT('tlw', MD5('AVAXUSDT')),  'AVAXUSDT',  '2000-01-01 00:00:08.000'),
  (CONCAT('tlw', MD5('AAVEUSDT')),  'AAVEUSDT',  '2000-01-01 00:00:09.000'),
  (CONCAT('tlw', MD5('FILUSDT')),   'FILUSDT',   '2000-01-01 00:00:10.000'),
  (CONCAT('tlw', MD5('ONDOUSDT')),  'ONDOUSDT',  '2000-01-01 00:00:11.000'),
  (CONCAT('tlw', MD5('TIAUSDT')),   'TIAUSDT',   '2000-01-01 00:00:12.000'),
  (CONCAT('tlw', MD5('OPUSDT')),    'OPUSDT',    '2000-01-01 00:00:13.000'),
  (CONCAT('tlw', MD5('ETCUSDT')),   'ETCUSDT',   '2000-01-01 00:00:14.000'),
  (CONCAT('tlw', MD5('ASTERUSDT')), 'ASTERUSDT', '2000-01-01 00:00:15.000'),
  (CONCAT('tlw', MD5('TAOUSDT')),   'TAOUSDT',   '2000-01-01 00:00:16.000'),
  (CONCAT('tlw', MD5('LTCUSDT')),   'LTCUSDT',   '2000-01-01 00:00:17.000');

-- Seed 2: every coin ever traded on Bitget or MEXC, after the hand-added ones (most recent close first).
INSERT IGNORE INTO `trading_list_watchlist_symbols` (`id`, `symbol`, `createdAt`)
SELECT CONCAT('tlw', MD5(r.sym)), r.sym, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL r.rn SECOND)
FROM (
  SELECT t.sym, ROW_NUMBER() OVER (ORDER BY t.lastClose ASC) AS rn
  FROM (
    SELECT u.sym, MAX(u.closedAt) AS lastClose
    FROM (
      SELECT UPPER(REPLACE(`symbol`, '_', '')) AS sym, COALESCE(`closedAt`, `openedAt`) AS closedAt FROM `bitget_trades`
      UNION ALL
      SELECT UPPER(REPLACE(`symbol`, '_', '')) AS sym, COALESCE(`closedAt`, `openedAt`) AS closedAt FROM `mexc_trades`
    ) u
    GROUP BY u.sym
  ) t
) r;
