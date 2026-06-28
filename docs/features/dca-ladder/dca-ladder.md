## Description

BTC DCA Ladder is a manual-tracking feature for a tier-based dip-buying strategy on BTC/USDT.
The user configures a start capital and tier parameters; the system computes planned buy prices
from a frozen daily-candle peak (fetched from Binance), allocates a compounded budget per cycle,
and arms buy-tier orders at percentage step intervals below the peak. The user confirms fills
manually via the web UI or Telegram. After the **first** fill, a TP sell order is armed immediately
and its price is updated on every subsequent fill. Closing the cycle records realised PnL and starts
a new cycle with the updated compounded budget. A daily cron (`10 0 * * *` UTC) syncs the peak,
detects tier touches, and broadcasts a Telegram alert when action is needed.

The **first tier is weekly-trend-adaptive**: in a weekly uptrend the ladder starts shallow
(`firstTierPct`, default 5% below peak → catch more dip-bounces); in a bear/neutral week it starts
deep (`bearFirstTierPct`, default 10% → lower avgCost, less knife-catching). Backtested in
`claude-backtest/runs/2026-06-28-dca-ladder-weekly-adaptive-firsttier.md`: this keeps the
low-drawdown profile of the deep entry while recovering most of the shallow entry's return (and
beats both static configs in the 365d/730d windows).

## Main Flow

1. **Seed / new cycle** (`getState` on first call): `DcaLadderService.ensureCycle` calls
   `fetchSeedPeak` (30-day max daily high from Binance klines), calls `computeBudget` to derive
   the compounded USD budget (`startCapital + Σ realizedPnl` of all CLOSED cycles), creates a FLAT
   `DcaLadderCycle`, then calls `armBuyTiers` which uses `tierPrices(peak, params)` from
   `@app/core` to place N ARMED BUY orders spaced `stepPct`% below the peak, each with
   `usdAmount = budget / numTiers`. The first-tier % is resolved by `resolveFirstTierPct` (weekly
   trend → `firstTierPct` if bull, else `bearFirstTierPct`).

2. **Daily sync** (Worker cron `@Cron('10 0 * * *', { timeZone: 'UTC' })` in
   `SchedulerService.runDcaLadderSync`): `DcaLadderSyncService.syncDaily` fetches the last 2
   daily klines via `BinanceMarketDataService.fetchKlines`. For FLAT cycles it raises the peak to
   the previous day's high if higher, then **re-arms all ARMED buy-tier `plannedPrice`s every day**
   using `resolveFirstTierPct` (the weekly-adaptive first tier) — so both a new peak AND a weekly
   bull↔bear flip are reflected. New prices take effect the next candle: the tier-touch check below
   uses a snapshot of the prices in effect at candle open. Then, if the previous day's low touched
   any ARMED tier, those orders are set to `PENDING_FILL` and a Telegram alert is sent inline. For
   IN_POSITION cycles, if the high reached `tpPrice`, the SELL order is set to `PENDING_FILL`.

3. **Confirm fill** (`POST /dca-ladder/orders/:id/fill { fillPrice }`): marks the order `FILLED`,
   calls `recompute` which calls `computePosition(fills, feePct)` and `computeTpPrice(avgCost, tpPct)`
   from `@app/core`. After **any** fill (including the first), the cycle transitions to `IN_POSITION`
   and a SELL order is armed (or repriced if it already exists).

4. **Unfill** (`POST /dca-ladder/orders/:id/unfill`): reverts the order to `ARMED` and calls
   `recompute`. If all buys are now unfilled, the cycle reverts to `FLAT` and the SELL is `CANCELLED`.

5. **Edit prices** (`PATCH /dca-ladder/orders/:id { plannedPrice?, fillPrice? }`): updates the
   stored price and calls `recompute`.

6. **Close cycle / TP** (`POST /dca-ladder/close { sellPrice }`): calls
   `computeRealizedPnl(positionSize, avgCost, sellPrice, capitalDeployed, feePct)`, records
   `realizedPnl` on the CLOSED cycle, creates a new FLAT cycle (with `peak = sellPrice` and budget
   compounded from all closed cycles including the one just closed), then calls `armBuyTiers` for
   the new cycle (first-tier % resolved from the current weekly trend).

7. **Update settings** (`PUT /dca-ladder/settings`): persists the new settings, then — **only if
   the current cycle is FLAT** — recomputes the budget from the new `startCapital` using all closed
   cycles' `realizedPnl`, updates `cycle.budget`, and re-arms buy tiers via `armBuyTiers`. Cycles
   that are IN_POSITION are never re-armed (filled buys must not be deleted).

8. **Web page** (`/dca-ladder`): Server Component fetches `GET /dca-ladder` (returns
   `{ settings, cycle, orders, livePrice, timingSignal, summary }`), passes `initialState` to
   `DcaLadderFeed` (client component). Summary cards show cycle count, avg fills/cycle, realised
   PnL, unrealised PnL. A **DCA timing-signal panel** (see below) sits above the ladder table.
   Ladder table supports inline price edits, fill confirmation, unfill, and TP close.
   Settings panel allows reconfiguring all parameters.

## DCA Timing Signal (chiến lược /tracking-coins áp cho BTC)

To answer "is now a reasonable moment to **start** a DCA layer?", `getState()` computes the same
DCA signal the `/tracking-coins` dashboard uses, but for BTC only, via
`computeDcaTimingSignal(d1, w1, marketCap)` in `@app/core` (`packages/core/src/analysis/dca-signal.ts`):

- **Timing zone** (D1-driven, `dcaZone`): `GOM` (RSI ≤ 35 **and** within 8% of the rolling 20-day
  low, below EMA34 → good time to add a tier), `CHO` (below EMA34 but not yet oversold → wait),
  `CHOT` (price reclaimed EMA34 → take-profit zone, not an entry).
- **Safety score** (weekly-structure-driven, `computeDcaScore` → 0–100 + `dcaQualityBucket`):
  market cap (BTC market cap = `livePrice × 19.8M` circulating supply → always top "safe" tier) +
  weekly trend/EMA89/EMA200/UTBot-W1. This is the survival lever that replaces a stop-loss.
- Supporting metrics surfaced: D1 RSI(14), EMA34 above/below, % above 20-day low, weekly trend.

`fetchTimingSignal` fetches 220 D1 + 300 W1 klines from Binance in parallel. It is **non-fatal**:
any error logs a warning and `timingSignal` is returned as `null` (panel hidden). It is advisory
only — it does **not** auto-arm tiers or change the peak; the user still confirms fills manually.

## Weekly-adaptive first tier

The first tier's distance below the peak depends on the BTC **weekly trend** (the same
`computeTimeframeTrend` used for `weekTrend`):

- weekly **bull** (`Up` / `StrongUp`) → `firstTierPct` (default **5%**) — shallower, catches more
  dip-bounce cycles in an uptrend.
- weekly **bear/neutral** (`Down` / `StrongDown` / `Neutral`) → `bearFirstTierPct` (default **10%**)
  — deeper entry, lower avgCost, less knife-catching.

Resolved by `effectiveFirstTierPct(weekTrend, bullPct, bearPct)` in `@app/core`, called from
`DcaLadderService.resolveFirstTierPct` (API, fetches 300 W1 klines) and
`DcaLadderSyncService.resolveFirstTierPct` (worker, via `BinanceMarketDataService`). Only the first
tier shifts; `numTiers`/`stepPct` are unchanged. Disable the adaptivity by setting
`bearFirstTierPct = firstTierPct`. The web timing panel shows the currently effective first tier.

## Edge Cases

- **No cycle yet**: `ensureCycle` bootstraps a FLAT cycle on the first `getState` call.
- **Binance unreachable during sync**: `syncDaily` propagates the error to `runDcaLadderSync`
  which catches and logs it; the pm2 worker process stays healthy.
- **Partial fills**: `recompute` is called after every fill/unfill; the TP SELL is armed after the
  **first** fill and repriced on every subsequent fill — not only after all tiers are filled.
- **Settings change mid-cycle (FLAT)**: `updateSettings` re-arms all tiers with the new `numTiers`,
  updated `usdAmount = newBudget / newNumTiers`, and recalculated tier prices.
- **Settings change mid-cycle (IN_POSITION)**: `updateSettings` persists the new settings but does
  NOT re-arm (preserves filled buys). New params take effect on the next cycle.
- **Fee handling**: `computeRealizedPnl` deducts round-trip fees from both buy and sell legs using
  `feePct` (default 0.05% per side → 0.1% round-trip). Buy-side fee is baked into `avgCost`.
- **Compounded budget**: `budget = startCapital + Σ realizedPnl(all CLOSED cycles)`. Each new
  cycle's budget is computed fresh from all historical closed cycles, not by chaining previous
  budgets (avoids double-counting).
- **Peak tracking (FLAT)**: daily sync raises the peak when a new high is established; it never
  lowers the peak once IN_POSITION (the peak is frozen at entry time).
- **Weekly trend unavailable**: if the W1 klines fetch fails, `resolveFirstTierPct` falls back to
  `firstTierPct` (the bull value) and logs a warning — non-fatal, keeps prior behaviour.
- **Weekly flip while FLAT**: the daily worker re-arms tier prices every FLAT day, so a bull→bear
  flip deepens the first tier (and vice-versa) even without a new peak. IN_POSITION cycles are never
  re-armed (peak + tiers frozen), so the first-tier choice is locked in at entry.

## Related Files (FE / BE / Worker)

### Core math
- `packages/core/src/analysis/dca-ladder.ts` — `tierPctBelow`, `tierPrices`, `computePosition`, `computeTpPrice`, `computeRealizedPnl`, `computeBudget`, `effectiveFirstTierPct` (weekly-adaptive first tier), `DcaLadderParams`, `DcaFill`, `DcaPosition`
- `packages/core/src/analysis/dca-signal.ts` — `computeDcaTimingSignal` (the /tracking-coins DCA signal for BTC), reusing `dcaZone` + `computeDcaScore` + `dcaQualityBucket`; types `DcaTimingSignal`, `DcaTimingSeries`

### Database
- `packages/db/prisma/schema.prisma` — `DcaLadderSettings` (incl. `bearFirstTierPct`), `DcaLadderCycle`, `DcaLadderOrder` models
- `packages/db/prisma/migrations/20260627130000_add_dca_ladder/migration.sql` — initial migration
- `packages/db/prisma/migrations/20260628120000_add_dca_ladder_bear_first_tier/migration.sql` — adds `bearFirstTierPct`
- `packages/db/src/repositories/dca-ladder.repository.ts` — `createDcaLadderRepository()` (upsert settings, get/create/update cycle, list/update/delete orders)

### API module
- `apps/api/src/modules/dca-ladder/dca-ladder.module.ts` — NestJS module
- `apps/api/src/modules/dca-ladder/dca-ladder.controller.ts` — REST routes (`GET`, `GET /settings`, `PUT /settings`, `POST /orders/:id/fill`, `POST /orders/:id/unfill`, `PATCH /orders/:id`, `POST /close`)
- `apps/api/src/modules/dca-ladder/dca-ladder.service.ts` — business logic: `ensureCycle`, `armBuyTiers`, `recompute`, `fillOrder`, `unfillOrder`, `updateOrder`, `closeCycle`, `updateSettings`, `getState`, `fetchTimingSignal` (DCA timing signal for BTC), `fetchWeekTrend` + `resolveFirstTierPct` (weekly-adaptive first tier)
- `apps/api/src/modules/dca-ladder/dto/update-settings.dto.ts` — `UpdateDcaLadderSettingsDto`
- `apps/api/src/modules/dca-ladder/dto/fill-order.dto.ts` — `FillOrderDto`
- `apps/api/src/modules/dca-ladder/dto/update-order.dto.ts` — `UpdateOrderDto`
- `apps/api/src/modules/dca-ladder/dto/close-cycle.dto.ts` — `CloseCycleDto`

### Worker sync + cron
- `apps/worker/src/modules/dca-ladder/dca-ladder.service.ts` — `DcaLadderSyncService.syncDaily()` (fetch klines via `BinanceMarketDataService`, update peak, re-arm tiers with the weekly-adaptive first tier via `resolveFirstTierPct`, detect tier touches, send Telegram text inline)
- `apps/worker/src/modules/dca-ladder/dca-ladder.module.ts` — Worker NestJS module (imports `MarketModule`, `TelegramModule`)
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `@Cron('10 0 * * *', { timeZone: 'UTC' })` on `runDcaLadderSync()`

### Web page + client
- `apps/web/src/shared/api/types.ts` — `DcaLadderSettings`, `DcaLadderCycle`, `DcaLadderOrder`, `DcaLadderSummary`, `DcaLadderTimingSignal`, `DcaLadderState`
- `apps/web/src/shared/api/client.ts` — `fetchDcaLadder`, `updateDcaLadderSettings`, `fillDcaOrder`, `unfillDcaOrder`, `updateDcaOrder`, `closeDcaCycle`
- `apps/web/src/widgets/dca-ladder/dca-ladder-feed.tsx` — interactive ladder UI (client component)
- `apps/web/src/_pages/dca-ladder-page/dca-ladder-page.tsx` — Server Component page
- `apps/web/src/app/dca-ladder/page.tsx` — thin App Router re-export
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry `/dca-ladder`
- `apps/web/src/app/globals.css` — `.dcal-*` styles (light mode only, using app theme tokens `--surface`/`--border`/`--foreground`/`--muted`)
