## Description
Turns `/tracking-coins` into a **DCA dashboard** for the user's no-stop-loss, dollar-cost-average
strategy: gom (add) into deep dips, take profit when price reclaims EMA34/EMA89.

Backtest (`claude-backtest/runs/2026-06-26-dca-dip-d1-no-sl.md`) showed this works (80–100% win rate)
on coins that survive and mean-revert, but is ruinous on coins that die or trend down for years —
so the #1 risk lever is **coin selection**, which replaces the stop-loss. Two signals are shown:

- **DCA score (0–100)** — "how safe is it to DCA this coin?" from **market cap** (death risk) +
  **weekly trend** (long-term structure alive). Label: ≥70 An toàn / ≥50 Khá / ≥30 Rủi ro / <30 Tránh.
- **Action zone** — `GOM` (oversold near 20d low → add a layer) / `CHO` (wait) / `CHOT` (reclaimed
  EMA34 → take profit).

The earlier trend-following Entry Score (`tracking-coins-entry-score`) is superseded for display but
its column/logic remain in the DB and scan (harmless) — see that doc.

## Main Flow
1. Daily/manual scan (`TrackingCoinScanService` worker, `TrackingCoinsService.scanOneCoin` API)
   builds the D1/H4/W1 signal and computes `low20Pct` (% above the rolling 20-day low).
2. `computeDcaScore` (`@app/core`) scores survival from `marketCap` (max 50) + weekly trend/EMA/UTBot
   (max 50). Persisted as `dcaScore`, with `low20Pct`, on `TrackingCoinSignal`.
3. API `listCoins` derives the action `dcaZone` from stored `ema34Above` / `rsi` / `low20Pct`.
4. The feed shows a **DCA** column (quality badge + zone tag) and defaults to sorting by `dcaScore` desc
   so the safest-to-DCA coins surface first.

## Trend column (PA) — W / D1 / H4
The per-timeframe `trend` (5 levels ↑↑/↑/→/↓/↓↓) comes from `computePaTrend` in `@app/core`
(`computeTimeframeTrend` for W/H4, inside `computeSmallCapSignal` for D1). It mirrors the
**daily-plan** trend engine the user validated (`apps/worker/.../market/utils/trend.ts` `detectTrend`):
**1-bar swing pivots over the full series** (a candle whose high/low tops/bottoms both neighbours),
then compare the last two swing highs and last two swing lows — **HH+HL = bullish, LH+LL = bearish,
anything else (including equal swings) = neutral**. The 5-level display overlays EMA89: bullish above
EMA89 → StrongUp (else Up), bearish below EMA89 → StrongDown (else Down), neutral → Neutral. The same
weekly trend feeds `computeDcaScore`, so a cleaner weekly read also sharpens the safety score.

## DCA position tracking (manual buy log)
Each DCA buy (layer) is logged per coin via the **DCA position** tab inside the coin detail modal.
Clicking the layers icon in the row actions (which shows the layer count when holding) opens the
same detail modal used by a row click, but with the **DCA position** tab pre-selected instead of
Overview. From the buy log the API derives:
- **avgEntry** = Σusd / Σ(usd/price) — the real break-even, since "reclaim EMA34" only profits above it.
- **capitalDeployed** = Σusd, **layers** = buy count (capped at 5 in the UI).
- **nextAddPrice** = lastAdd × 0.92 (the backtested −8% step).
- **live P&L** = (livePrice − avgEntry) / avgEntry, computed client-side from the feed's live price.

The panel shows a **profit-aware take-profit hint**: green when livePrice ≥ avgEntry ("reclaim EMA34
= chốt có lãi"), amber otherwise ("EMA34 có thể vẫn lỗ; chốt khi giá ≥ giá TB"). "Đóng vị thế" clears
all buys after taking profit. The row's list view also shows a lightweight `dcaPosition` aggregate
(layers / avgEntry / capitalDeployed) so a holding is visible at a glance.

## Portfolio sync (two-way)
Each DCA layer mirrors a portfolio **CoinTransaction**, so the dashboard and the user's
portfolio stay in sync (`symbol` ≡ portfolio `coinId`, both bare e.g. `BTC`).

- **Pick portfolio per buy.** The DCA dialog has a portfolio dropdown (the user has 3 allocation
  buckets); the last choice per coin is remembered in `localStorage` (`dca-portfolio:<symbol>`).
- **+Gom → BUY (forward).** `addDcaBuy(symbol, {price, usd, portfolioId}, userId)` validates portfolio
  ownership, creates a BUY `CoinTransaction` (`amount = usd / price`) → holding recomputes, and stores
  `transactionId`/`portfolioId` on the `TrackingCoinDcaBuy` link.
- **Delete layer ↔ delete transaction (both ways).** Deleting a layer soft-deletes the linked
  transaction; deleting that transaction in the portfolio UI cascades back and removes the layer
  (`TransactionService.removeTransaction` → `deleteDcaBuysByTransactionId`).
- **Đóng vị thế (đã chốt) → SELL.** Closing prompts for a sell price (defaults to live price) and
  creates a SELL of **exactly the DCA-accumulated amount per portfolio** (clamped to the held amount so
  it never dumps unrelated holdings of the same coin), realising P&L, then clears the buy log.
- Layers without a `portfolioId` (added before sync, or when no portfolio exists) behave as before — a
  local-only buy log with no transaction.

## Edge Cases
- **Micro-cap / unknown market cap** → 0 cap points → can never reach "An toàn" (high death risk).
- **Missing signal** (never scanned) → DCA cell shows "—".
- **Null RSI** in zone derivation defaults to 50 (treated as not-oversold → not GOM).
- **No buys logged** → `dcaPosition` is null; the action button shows the layers icon, not a count.
- Adding a buy is blocked in the UI once 5 layers are reached (the strategy cap).

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/dca-signal.ts` — `computeDcaScore` + `dcaZone`
- `packages/core/src/analysis/small-cap-signal.ts` — `computePaTrend`/`computeTimeframeTrend` (PA trend, daily-plan style)
- `packages/core/src/analysis/small-cap-signal.spec.ts` — trend unit tests
- `packages/core/src/analysis/dca-signal.spec.ts` — unit tests
- `packages/core/src/index.ts` — exports
- `packages/db/prisma/schema.prisma` — `TrackingCoinSignal.dcaScore`/`low20Pct`, `TrackingCoinDcaBuy` model
- `packages/db/prisma/migrations/20260626140000_tracking_coin_dca_score/migration.sql`
- `packages/db/prisma/migrations/20260626160000_tracking_coin_dca_buys/migration.sql`
- `packages/db/src/repositories/tracking-coins.repository.ts` — DCA-buy CRUD + buys in list query
- `apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts`
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — score/zone + `aggregateDca` + position CRUD + **portfolio sync** (forward BUY/SELL via `TransactionService`, ownership via `PortfolioService`, clamp via `HoldingsService`)
- `apps/api/src/modules/tracking-coins/tracking-coins.module.ts` — imports `TransactionModule`/`PortfolioModule`/`HoldingsModule`
- `apps/api/src/modules/transaction/transaction.service.ts` — `removeTransaction` reverse-syncs (deletes linked DCA layer)
- `apps/api/src/modules/holdings/holdings.service.ts` — `getHoldingAmount` (clamp helper for close-position SELL)
- `packages/db/prisma/migrations/20260627120000_dca_buy_portfolio_link/migration.sql` — `portfolioId`/`transactionId` on `TrackingCoinDcaBuy`
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — dca-position / dca-buys routes
- `apps/api/src/modules/tracking-coins/dto/add-dca-buy.dto.ts`
- `apps/web/src/shared/api/types.ts` — `dcaScore`/`dcaZone`/`low20Pct`, `dcaPosition`, `DcaPosition`/`DcaBuy`
- `apps/web/src/shared/api/client.ts` — `fetchDcaPosition`/`addDcaBuy`/`deleteDcaBuy`/`closeDcaPosition`
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `DcaCell`, `CoinDetailModal` (hosts the `DCA position` tab), `DcaPositionPanel`, sort/column
- `apps/web/src/app/globals.css` — `.tc-dca*`, `.tc-zone*`, `.dcapos-*` styles
