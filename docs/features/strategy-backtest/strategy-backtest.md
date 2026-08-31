# Strategy Backtest (`/strategy-backtest`)

## Description
A scorecard for the trader's own manual analysis. Setups are written by hand on the page —
direction, a limit entry, a stop and (optionally) a target — and a worker cron then watches
the market for them exactly the way a resting limit order on an exchange behaves: it waits
at the entry, fills when price trades through it, and closes at TP or SL.

Nothing here is automated analysis and nothing places a real order. The point is to answer
"were my setups actually any good?" with a win rate, an R total and a fill rate, instead of
from memory. Today only `BTCUSDT` is tracked; the table and the scan job already key on
`symbol`, so adding pairs is a UI change only.

The data lives in its own table (`strategy_backtest_setups`) with no relation to
`Order`/`Signal`/`TrackingCoin` — deliberately, so this history is never touched by the
automated pipelines.

## Main Flow
1. The trader opens `/strategy-backtest` and fills in the form: LONG/SHORT, entry (the limit
   price), stop loss, optional take profit, and a note on why the setup is worth taking. The
   planned R:R updates live while the numbers are typed.
2. `POST /strategy-backtest` validates that the three prices describe a real trade (LONG →
   stop below entry, target above; mirrored for SHORT) and stores the setup as `PENDING`.
3. Every 5 minutes `SchedulerService.runStrategyBacktestScan()` calls
   `StrategyBacktestScanService.scan()`, which loads the open setups, groups them by symbol
   and fetches 60 public Binance **5m** candles per symbol.
4. `replaySetup()` replays only the candles newer than the setup's `lastCheckedAt` watermark:
   - `PENDING` → `ENTERED` when a candle trades through `entryPrice` (LONG needs the low to
     reach it, SHORT the high) — `triggeredAt` is stamped.
   - `ENTERED` → `SL_HIT` / `TP_HIT` when a candle trades through the stop or the target.
     `exitPrice`, `pnlPct` (net of 0.05%/side) and `rMultiple` are written on close.
5. The page polls `GET /strategy-backtest` every 60s. The API returns the setups plus the
   live price, and computes `plannedRr`, `distanceToEntryPct` (PENDING) and
   `unrealizedPct` / `unrealizedR` (ENTERED) on the fly — none of those are stored.
6. Anything the job cannot decide is the trader's call: cancel a setup that has not filled,
   or close a filled one by hand at the live price (`CLOSED`).

## Edge Cases
- **A candle that trades through both the stop and the target is scored as the stop.** Intra-
  candle order is unknowable from OHLC, so the pessimistic read is the only one that cannot
  flatter the win rate. The same rule lets a setup fill *and* stop out inside one candle.
- **A new setup never back-fills against history.** The replay skips every candle that closed
  before the setup was created; only the single candle straddling creation is kept, because
  dropping it would lose up to 5 minutes of real fills.
- **Missed passes are caught up, not lost.** The scan fetches 5 hours of candles and replays
  from the `lastCheckedAt` watermark, so a worker restart or a deploy is replayed on the next
  pass. Re-processing an already-seen candle is harmless: the state machine only moves forward.
- **Overlapping runs are skipped**, guarded by an in-service `scanning` flag.
- **Binance failures are non-fatal.** A symbol that throws is logged and retried in 5 minutes
  with its watermark untouched. On the API side a failed price fetch returns `price: null` and
  the board still renders, just without the live columns.
- **A setup without a take profit** runs until the stop or a manual close — it is never closed
  on an up move.
- **Prices are frozen once a setup fills.** `PATCH` rejects price edits unless the setup is
  still `PENDING`; the note stays editable for the whole life of the setup.
- **Cancel only applies to unfilled setups; manual close only to filled ones** — both rejected
  with a Vietnamese message the dialog shows verbatim.
- **Stats exclude what they should.** Win rate and R are computed only over setups that filled
  *and* finished; a cancelled setup never risked anything and an open one has not resolved.
  A break-even close counts as a loss, not a win.
- **No expiry.** A `PENDING` setup waits indefinitely — by the trader's choice, it is cancelled
  by hand. There is no Telegram notification either; the page is the only surface.

## Related Files (FE / BE / Worker)

**Web**
- `apps/web/src/app/strategy-backtest/page.tsx` — route, thin re-export
- `apps/web/src/_pages/strategy-backtest-page/strategy-backtest-page.tsx` — Server Component, loads the board
- `apps/web/src/widgets/strategy-backtest/strategy-backtest-board.tsx` — client widget: form, filters, cards, 60s polling
- `apps/web/src/widgets/strategy-backtest/setup-stats.ts` — pure scorecard math (win rate, R, fill rate)
- `apps/web/src/widgets/strategy-backtest/setup-stats.spec.ts` — its tests
- `apps/web/src/shared/api/client.ts` — `fetchStrategyBacktestBoard` and the mutations (via `mutationJson`, which surfaces the API's message)
- `apps/web/src/shared/api/types.ts` — `StrategyBacktestSetup`, `StrategyBacktestBoard`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry
- `apps/web/src/app/globals.css` — `.sbt-*` styles

**API**
- `apps/api/src/modules/strategy-backtest/strategy-backtest.controller.ts` — `GET /`, `POST /`, `PATCH /:id`, `POST /:id/cancel`, `POST /:id/close`, `DELETE /:id`
- `apps/api/src/modules/strategy-backtest/strategy-backtest.service.ts` — validation, live-price enrichment, manual close
- `apps/api/src/modules/strategy-backtest/dto/*.ts` — `class-validator` DTOs
- `apps/api/src/app.module.ts` — module registration

**Worker**
- `apps/worker/src/modules/strategy-backtest/strategy-backtest-scan.service.ts` — the 5m scan and the pure `replaySetup()`
- `apps/worker/src/modules/strategy-backtest/strategy-backtest.module.ts`
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — the `*/5 * * * *` cron
- `apps/worker/test/strategy-backtest-scan.service.spec.ts` — replay tests

**Shared**
- `packages/core/src/setups/strategy-backtest-math.ts` — PnL / R / R:R formulas shared by worker and API
- `packages/db/prisma/schema.prisma` — `StrategyBacktestSetup`
- `packages/db/prisma/migrations/20260831120000_add_strategy_backtest_setups/migration.sql`
- `packages/db/src/repositories/strategy-backtest.repository.ts`
