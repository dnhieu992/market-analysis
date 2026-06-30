## Description
Adds an **M30 (30-minute)** timeframe row to the per-coin indicator panels on the
`/tracking-coins` page. It mirrors the existing W / D1 / H4 signal set (PA trend,
UT Bot bull/bear, EMA 34/89/200 pips, RSI, Vol×). The M30 signal is **display-only**
— it is NOT fed into any scoring or order logic (signalScore, entryScore, dcaScore,
long/short score, swing/limit orders all remain unchanged). Only `m30Trend` (already
existing) continues to feed `computeLongShortScore`; the newly added M30 indicators are
purely for visual reference.

## Main Flow
1. Scan (worker cron `TrackingCoinScanService` or API `TrackingCoinsService.scanOneCoin`)
   already fetches 300 × M30 klines from Binance.
2. From those klines compute display-only indicators: `m30Ema34Above/89/200`,
   `m30Rsi`, `m30VolMultiplier`, and `utBotM30Bullish` (UT Bot ATR 10 / key value 3,
   same config as the other timeframes).
3. Persist them on `TrackingCoinSignal` alongside the W/D1/H4 fields via `upsertSignal`.
4. API `listCoins` maps the new fields into the `signal` payload.
5. Web renders an **M30** row in both the main table `TfStack` (Trend / UT Bot / EMA /
   RSI / Vol columns) and the coin-detail "Chỉ báo theo khung" grid.

## Edge Cases
- Not enough M30 candles for an EMA/RSI/Vol period → that field is `null` and the cell
  renders as a muted dash, identical to the W/H4 handling.
- Columns are `Boolean?` / `Float?` (nullable) with no default, so pre-existing signal
  rows show empty M30 cells until the next scan repopulates them.
- `utBotM30Bullish` needs ≥ 2 candles, otherwise `null`.
- `TfStack`'s `m30` prop is optional; passing `undefined` keeps the old 3-row layout, so
  any other consumer of `TfStack` is unaffected.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — adds `utBotM30Bullish`, `m30Ema34Above/89/200Above`, `m30Rsi`, `m30VolMultiplier` to `TrackingCoinSignal`
- `packages/db/prisma/migrations/20260630120000_add_m30_indicators_to_tracking_coins/migration.sql` — column migration
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — computes + persists M30 indicators in `scanOneCoin`; exposes them in the `listCoins` payload + return type
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts` — computes + persists M30 indicators during the scheduled scan
- `apps/web/src/shared/api/types.ts` — adds M30 fields to the tracking-coin `signal` type
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `TfStack` gains an optional M30 row; main table + detail overview render the M30 signal
