## Description
An append-only change-log of the radar signal for each small-cap coin, so the
user can compare how a coin's radar stage evolved over time. A new history row is
written **only when the stage (Breakout/Trending/Accumulating/Waking/Extended/
Quiet) differs from the most recent row** — so the daily scans do not bloat the
log; it records stage transitions only. Raw snapshot fields are stored (no
forward-return/outcome evaluation). This mirrors the tracking-coins DCA signal
history (see `docs/features/tracking-coins-signal-history`), with `stage` playing
the role that the DCA zone/bucket plays there.

## Main Flow
1. A scan runs — either the worker cron (`runSmallCapScan`, daily 00:05 UTC) or
   the manual `POST /small-cap-radar/scan`.
2. After `upsertSignal`, the scan calls
   `repo.logSignalHistoryIfChanged(coinId, {...})` which reads the most recent
   history row; if `stage` is unchanged it returns `null` (skip), otherwise it
   inserts a new `SmallCapSignalHistory` row (price = latest daily close).
3. On the radar page, each coin row has a 🕒 button →
   `GET /small-cap-radar/coins/:symbol/signal-history` → a modal renders the
   change-log newest-first (time, stage, signal score, trend, RSI, Vol×, Ext%,
   price).

## Edge Cases
- **First scan ever for a coin** — no prior row, so the first snapshot is inserted.
- **Stage unchanged across many scans** — nothing is written; log stays compact.
- **Signal score wobbles within the same stage** — intentionally NOT logged.
- **Both scan paths log** — worker cron and API manual scan both call
  `logSignalHistoryIfChanged`.
- **History button click** — `stopPropagation()` prevents the row's default
  action (opening TradingView).
- **Coin deleted / re-synced** — history rows cascade-delete via the FK on
  `small_cap_coins` (so `rescan-coins` pruning also clears their history).

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — `SmallCapSignalHistory` model
- `packages/db/prisma/migrations/20260627061442_add_small_cap_signal_history/migration.sql` — table creation
- `packages/db/src/repositories/small-cap-radar.repository.ts` — `logSignalHistoryIfChanged()`, `findSignalHistory()`
- `apps/worker/src/modules/small-cap-scan/small-cap-scan.service.ts` — logs history after upsertSignal (cron path)
- `apps/api/src/modules/small-cap-radar/small-cap-radar.service.ts` — logs history (manual scan) + `getSignalHistory()`
- `apps/api/src/modules/small-cap-radar/small-cap-radar.controller.ts` — `GET coins/:symbol/signal-history`
- `apps/web/src/shared/api/types.ts` — `SmallCapHistoryRow` type
- `apps/web/src/shared/api/client.ts` — `fetchSmallCapSignalHistory()`
- `apps/web/src/widgets/small-cap-radar/small-cap-radar-feed.tsx` — `HistoryModal` + 🕒 button
- `apps/web/src/app/globals.css` — `.sc-history-btn`, `.sc-history-table` styles
