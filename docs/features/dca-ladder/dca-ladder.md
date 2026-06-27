## Description

BTC DCA Ladder is a manual-tracking feature for a tier-based dip-buying strategy on BTC/USDT.
The user configures a start capital and tier parameters; the system computes planned buy prices
from a frozen daily-candle peak (fetched from Binance), allocates a compounded budget per cycle,
and arms buy-tier orders at percentage step intervals below the peak. The user confirms fills
manually via the web UI or Telegram. After the **first** fill, a TP sell order is armed immediately
and its price is updated on every subsequent fill. Closing the cycle records realised PnL and starts
a new cycle with the updated compounded budget. A daily cron (`10 0 * * *` UTC) syncs the peak,
detects tier touches, and broadcasts a Telegram alert when action is needed.

## Main Flow

1. **Seed / new cycle** (`getState` on first call): `DcaLadderService.ensureCycle` calls
   `fetchSeedPeak` (30-day max daily high from Binance klines), calls `computeBudget` to derive
   the compounded USD budget (`startCapital + Σ realizedPnl` of all CLOSED cycles), creates a FLAT
   `DcaLadderCycle`, then calls `armBuyTiers` which uses `tierPrices(peak, params)` from
   `@app/core` to place N ARMED BUY orders spaced `stepPct`% below the peak, each with
   `usdAmount = budget / numTiers`.

2. **Daily sync** (Worker cron `@Cron('10 0 * * *', { timeZone: 'UTC' })` in
   `SchedulerService.runDcaLadderSync`): `DcaLadderSyncService.syncDaily` fetches the last 2
   daily klines via `BinanceMarketDataService.fetchKlines`. For FLAT cycles, if the previous day's
   high exceeds the stored peak, the cycle peak is updated and ARMED buy-tier `plannedPrice`s are
   recalculated. Then, if the previous day's low touched any ARMED buy tier's price, those orders
   are set to `PENDING_FILL` and a Telegram alert is sent inline (no formatter file — text is built
   directly in `syncDaily`). For IN_POSITION cycles, if the high reached `tpPrice`, the SELL order
   is set to `PENDING_FILL` and an alert is sent.

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
   the new cycle.

7. **Update settings** (`PUT /dca-ladder/settings`): persists the new settings, then — **only if
   the current cycle is FLAT** — recomputes the budget from the new `startCapital` using all closed
   cycles' `realizedPnl`, updates `cycle.budget`, and re-arms buy tiers via `armBuyTiers`. Cycles
   that are IN_POSITION are never re-armed (filled buys must not be deleted).

8. **Web page** (`/dca-ladder`): Server Component fetches `GET /dca-ladder` (returns
   `{ settings, cycle, orders, livePrice, summary }`), passes `initialState` to `DcaLadderFeed`
   (client component). Summary cards show cycle count, avg fills/cycle, realised PnL, unrealised PnL.
   Ladder table supports inline price edits, fill confirmation, unfill, and TP close.
   Settings panel allows reconfiguring all parameters.

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

## Related Files (FE / BE / Worker)

### Core math
- `packages/core/src/analysis/dca-ladder.ts` — `tierPctBelow`, `tierPrices`, `computePosition`, `computeTpPrice`, `computeRealizedPnl`, `computeBudget`, `DcaLadderParams`, `DcaFill`, `DcaPosition`

### Database
- `packages/db/prisma/schema.prisma` — `DcaLadderSettings`, `DcaLadderCycle`, `DcaLadderOrder` models
- `packages/db/prisma/migrations/20260627130000_add_dca_ladder/migration.sql` — migration
- `packages/db/src/repositories/dca-ladder.repository.ts` — `createDcaLadderRepository()` (upsert settings, get/create/update cycle, list/update/delete orders)

### API module
- `apps/api/src/modules/dca-ladder/dca-ladder.module.ts` — NestJS module
- `apps/api/src/modules/dca-ladder/dca-ladder.controller.ts` — REST routes (`GET`, `GET /settings`, `PUT /settings`, `POST /orders/:id/fill`, `POST /orders/:id/unfill`, `PATCH /orders/:id`, `POST /close`)
- `apps/api/src/modules/dca-ladder/dca-ladder.service.ts` — business logic: `ensureCycle`, `armBuyTiers`, `recompute`, `fillOrder`, `unfillOrder`, `updateOrder`, `closeCycle`, `updateSettings`, `getState`
- `apps/api/src/modules/dca-ladder/dto/update-settings.dto.ts` — `UpdateDcaLadderSettingsDto`
- `apps/api/src/modules/dca-ladder/dto/fill-order.dto.ts` — `FillOrderDto`
- `apps/api/src/modules/dca-ladder/dto/update-order.dto.ts` — `UpdateOrderDto`
- `apps/api/src/modules/dca-ladder/dto/close-cycle.dto.ts` — `CloseCycleDto`

### Worker sync + cron
- `apps/worker/src/modules/dca-ladder/dca-ladder.service.ts` — `DcaLadderSyncService.syncDaily()` (fetch klines via `BinanceMarketDataService`, update peak, detect tier touches, build and send Telegram text inline)
- `apps/worker/src/modules/dca-ladder/dca-ladder.module.ts` — Worker NestJS module (imports `MarketModule`, `TelegramModule`)
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `@Cron('10 0 * * *', { timeZone: 'UTC' })` on `runDcaLadderSync()`

### Web page + client
- `apps/web/src/shared/api/types.ts` — `DcaLadderSettings`, `DcaLadderCycle`, `DcaLadderOrder`, `DcaLadderSummary`, `DcaLadderState`
- `apps/web/src/shared/api/client.ts` — `fetchDcaLadder`, `updateDcaLadderSettings`, `fillDcaOrder`, `unfillDcaOrder`, `updateDcaOrder`, `closeDcaCycle`
- `apps/web/src/widgets/dca-ladder/dca-ladder-feed.tsx` — interactive ladder UI (client component)
- `apps/web/src/_pages/dca-ladder-page/dca-ladder-page.tsx` — Server Component page
- `apps/web/src/app/dca-ladder/page.tsx` — thin App Router re-export
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry `/dca-ladder`
- `apps/web/src/app/globals.css` — `.dcal-*` styles (light mode only, using app theme tokens `--surface`/`--border`/`--foreground`/`--muted`)
