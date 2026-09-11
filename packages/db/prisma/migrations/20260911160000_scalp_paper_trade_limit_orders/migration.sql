-- Move the scalp monitor from market entries to resting LIMIT orders. A trade now
-- starts PENDING (a limit Claude pre-computed) and only flips to OPEN when a candle
-- touches the limit; it can also end CANCELLED (limit pulled before it filled).
-- `openedAt` becomes nullable because a PENDING order has no fill time yet.
-- Existing rows keep their openedAt values; the column just allows NULL going forward.

-- AlterTable
ALTER TABLE `scalp_paper_trades`
  MODIFY `openedAt` DATETIME(3) NULL;
