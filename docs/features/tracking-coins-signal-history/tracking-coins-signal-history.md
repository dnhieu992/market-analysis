## Description
An append-only change-log of the DCA signal for each tracking coin, so the user
can compare how a coin's DCA assessment evolved over time. A new history row is
written **only when the DCA action zone (GOM/CHO/CHOT) OR the quality bucket
(safe/ok/risky/avoid) differs from the most recent row** — so the 4-hour scans do
not bloat the log; it records meaningful state changes only. Raw snapshot fields
are stored (no forward-return/outcome evaluation yet).

## Main Flow
1. A scan runs — either the worker cron (`runTrackingCoinScan`, every 4h) or the
   manual `POST /tracking-coins/scan` (⚡ Re-analyze).
2. After `upsertSignal`, the scan computes `dcaZone(...)` and
   `dcaQualityBucket(dcaScore)` (both from `@app/core`).
3. `repo.logSignalHistoryIfChanged(coinId, {...})` reads the most recent history
   row; if zone AND bucket are unchanged it returns `null` (skip), otherwise it
   inserts a new `TrackingCoinSignalHistory` row.
4. The user opens a coin → **History** tab in the detail modal →
   `GET /tracking-coins/coins/:symbol/signal-history` returns the change-log,
   newest first, rendered as a table (time, DCA score+bucket, zone, W/D1/H4 trend,
   RSI, Ext%, price).

## Edge Cases
- **First scan ever for a coin** — no prior row, so the first snapshot is always
  inserted.
- **No change across many scans** — nothing is written; the log stays compact.
- **Score wobbles within the same bucket and zone** — intentionally NOT logged
  (e.g. 72 → 71 both "safe" and same zone → skipped).
- **`dcaZone` null handling** — repo compares `data.dcaZone ?? null` against the
  stored value so a null/non-null transition still counts as a change.
- **Both scan paths log** — worker cron and API manual re-analyze both call
  `logSignalHistoryIfChanged`, so manual re-analyze can also create a history row.
- **Coin deleted** — history rows cascade-delete via the FK on `tracking_coins`.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/dca-signal.ts` — `dcaQualityBucket()` helper (shared 70/50/30 thresholds)
- `packages/db/prisma/schema.prisma` — `TrackingCoinSignalHistory` model
- `packages/db/prisma/migrations/20260627060438_add_tracking_coin_signal_history/migration.sql` — table creation
- `packages/db/src/repositories/tracking-coins.repository.ts` — `logSignalHistoryIfChanged()`, `findSignalHistory()`
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts` — logs history after upsertSignal (cron path)
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — logs history (manual re-analyze) + `getSignalHistory()`
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — `GET coins/:symbol/signal-history`
- `apps/web/src/shared/api/types.ts` — `SignalHistoryRow` type
- `apps/web/src/shared/api/client.ts` — `fetchSignalHistory()`
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `CoinSignalHistory` component + History tab
- `apps/web/src/app/globals.css` — `.tc-history*` styles
