## Description

BTC DCA Ladder is a manual-tracking feature for a tier-based dip-buying strategy on BTC/USDT.
The user configures a start capital and tier parameters; the system computes planned buy prices
from a frozen daily-candle peak (fetched from Binance), allocates a compounded budget per cycle,
and arms buy-tier orders at percentage step intervals below the peak. The user confirms fills
manually via the web UI or Telegram. When all tiers are filled, a TP sell order is armed at
a configurable percentage above the average cost. Closing the cycle records realised PnL and
starts a new cycle with the updated compounded budget. A daily cron syncs the peak and live
price and broadcasts a summary to Telegram.

## Main Flow

1. **Seed / new cycle** (`POST /dca-ladder/close` or first run): `DcaLadderService.armBuyTiers`
   fetches the latest daily close from Binance via `fetchSeedPeak`, calls `computeBudget` to
   derive the compounded USD budget, then calls `computeTiers` to place N buy orders spaced
   `stepPct`% below the peak.
2. **Daily sync** (Worker cron `0 6 * * *` UTC): `DcaLadderSyncService.sync` calls
   `fetchLivePrice` (Binance ticker), updates `DcaLadderCycle.peak` if a new daily candle
   sets a higher peak, recomputes TP price via `recomputePosition`, and sends a Telegram
   summary via `DcaLadderTelegramFormatter.formatDailySummary`.
3. **Confirm fill** (`POST /dca-ladder/orders/:id/fill { fillPrice }`): marks the order
   `FILLED`, calls `recomputePosition` to update `avgCost`, `positionSize`, and `tpPrice`,
   transitions cycle to `IN_POSITION`, arms the TP sell order if all tiers are filled.
4. **Unfill** (`POST /dca-ladder/orders/:id/unfill`): reverts the order to `ARMED` and
   recalculates position.
5. **Edit prices** (`PATCH /dca-ladder/orders/:id { plannedPrice?, fillPrice? }`): updates
   the stored price and recalculates position.
6. **Close cycle / TP** (`POST /dca-ladder/close { sellPrice }`): calls
   `computeRealizedPnl(positionSize, avgCost, sellPrice, capitalDeployed, feePct)`, records
   `realizedPnl` on the cycle, transitions cycle to `CLOSED`, creates a new `FLAT` cycle,
   and arms fresh buy tiers.
7. **Update settings** (`PUT /dca-ladder/settings`): persists `DcaLadderSettings`, re-arms
   buy tiers for the current cycle.
8. **Web page** (`/dca-ladder`): Server Component fetches `GET /dca-ladder` (returns
   `{ settings, cycle, orders, livePrice, summary }`), passes `initialState` to
   `DcaLadderFeed` (client component). Summary cards show cycle count, avg fills/cycle,
   realised PnL, unrealised PnL. Ladder table supports inline price edits, fill confirmation,
   unfill, and TP close. Settings panel allows reconfiguring all parameters.

## Edge Cases

- **No cycle yet**: API bootstraps a `FLAT` cycle with empty orders when none exist in DB.
- **Binance unreachable during sync**: cron logs warning and skips the sync; does not throw,
  so pm2 worker stays healthy.
- **Partial fills**: `recomputePosition` is called after every fill/unfill; TP is armed only
  after all BUY tiers have `status = FILLED`.
- **Settings change mid-cycle**: `PUT /dca-ladder/settings` re-arms tiers but preserves
  already-FILLED orders — only ARMED/PENDING_FILL buy orders are replaced.
- **Fee handling**: `computeRealizedPnl` deducts round-trip fees from both buy and sell legs
  using `feePct` (default 0.05 % / side → 0.1 % round-trip).
- **Compounded budget**: each new cycle's budget = previous cycle's budget + realised PnL from
  the closed cycle (floor at `startCapital`).

## Related Files (FE / BE / Worker)

### Core math (Task 1)
- `packages/core/src/dca-ladder/dca-ladder.math.ts` — `computeTiers`, `computeBudget`, `recomputePosition`, `computeRealizedPnl`
- `packages/core/src/dca-ladder/index.ts` — barrel export

### Database (Task 2)
- `packages/db/prisma/schema.prisma` — `DcaLadderSettings`, `DcaLadderCycle`, `DcaLadderOrder` models
- `packages/db/prisma/migrations/20260627130000_add_dca_ladder/migration.sql` — migration
- `packages/db/src/repositories/dca-ladder.repository.ts` — `DcaLadderRepository` (upsert settings, get/create cycle, list/update orders)

### API module (Task 3)
- `apps/api/src/modules/dca-ladder/dca-ladder.module.ts` — NestJS module
- `apps/api/src/modules/dca-ladder/dca-ladder.controller.ts` — REST routes (`GET`, `PUT /settings`, `POST /orders/:id/fill`, `POST /orders/:id/unfill`, `PATCH /orders/:id`, `POST /close`)
- `apps/api/src/modules/dca-ladder/dca-ladder.service.ts` — business logic, Binance price fetch, arm tiers, recompute position

### Worker sync + cron + Telegram (Task 4)
- `apps/worker/src/modules/dca-ladder/dca-ladder-sync.service.ts` — `DcaLadderSyncService.sync()` (fetch live price, update peak, send Telegram)
- `apps/worker/src/modules/dca-ladder/dca-ladder-telegram.formatter.ts` — `formatDailySummary()`
- `apps/worker/src/modules/dca-ladder/dca-ladder.module.ts` — Worker NestJS module
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — cron `0 6 * * *` UTC wiring

### Web page + client (Task 5)
- `apps/web/src/shared/api/types.ts` — `DcaLadderSettings`, `DcaLadderCycle`, `DcaLadderOrder`, `DcaLadderSummary`, `DcaLadderState`
- `apps/web/src/shared/api/client.ts` — `fetchDcaLadder`, `updateDcaLadderSettings`, `fillDcaOrder`, `unfillDcaOrder`, `updateDcaOrder`, `closeDcaCycle`
- `apps/web/src/widgets/dca-ladder/dca-ladder-feed.tsx` — interactive ladder UI (client component)
- `apps/web/src/_pages/dca-ladder-page/dca-ladder-page.tsx` — Server Component page
- `apps/web/src/app/dca-ladder/page.tsx` — thin App Router re-export
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry `/dca-ladder`
- `apps/web/src/app/globals.css` — `.dcal-*` styles
