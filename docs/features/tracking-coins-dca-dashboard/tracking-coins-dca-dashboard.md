## Description
`/tracking-coins` is the single **bottom-accumulation DCA dashboard** (the old `/accumulation` page
was merged in on 2026-07-12 and now redirects here). The strategy — spot, **no stop-loss**, few orders:
**gom a strong bottom and HOLD for a full exit at x2 (+100%)**. No swing/dip timing, no EMA34 take-profit.

Backtest (`claude-backtest/runs/2026-07-12-bottom-dca-x2x3-merged.md`, supersedes the dip-buy and
EMA34-exit studies) established: selling on the EMA34 reclaim is net-negative (PF 0.72–0.81); the fix is
(1) **hold winners to a FULL exit at x2** — the sweet spot (PF 1.58; x2.5/x3 collapse the edge, and
half-x2/half-x3 only nets PF 1.02), and (2) **coin selection** as the stop-loss replacement — the
`dcaScore ≥ 50` survival gate lifts PF 1.58 → 3.53 and caps worst drawdown 99.98% → 43%. Two signals:

- **DCA score (0–100)** — survival gate: **market cap** (death risk) + **weekly trend** (structure
  alive). Label: ≥70 An toàn / ≥50 Khá / ≥30 Rủi ro / <30 Tránh. GOM is HARD-gated at ≥50.
- **Action zone** (`accZone`, from `computeAccumulationSignal`) — `GOM` (deep bottom 50–85% from peak +
  tight sideways base + RSI≤45 **AND** dcaScore≥50 → gom) / `CHO` (wait) / `Hồi` (price back above EMA34
  → no longer a bottom entry; exit is the x2 target on the position, not this zone).

The earlier trend-following Entry Score (`tracking-coins-entry-score`) and the dip-buy `dcaZone`
(oversold near 20d low) remain in the DB/scan (harmless, unused for display) — see those docs.

## Main Flow
1. Daily/manual scan (`TrackingCoinScanService` worker, `TrackingCoinsService.scanOneCoin` API)
   builds the D1/H4/W1 signal and computes `low20Pct` (% above the rolling 20-day low).
2. `computeDcaScore` (`@app/core`) scores survival from `marketCap` (max 50) + weekly trend/EMA/UTBot
   (max 50). Persisted as `dcaScore`, with `low20Pct`, on `TrackingCoinSignal`.
3. API `listCoins` derives the action `dcaZone` from stored `ema34Above` / `rsi` / `low20Pct`.
4. The feed shows a **DCA** column (quality badge + zone tag) and defaults to sorting by `dcaScore` desc
   so the safest-to-DCA coins surface first.

## Strategy & scoring info dialog
The page header shows the plain title **"Tracking Coins"** (the old "· Gom đáy" suffix was
dropped) with a small **info icon** (`i`) beside it. Clicking it opens `StrategyInfoDialog` — a
read-only modal that explains the running strategy (bottom-DCA x2: buy 50–85% below the cycle
peak in a tight sideways base with RSI ≤ 45, spot/no-SL, 3-tier −15% ladder, full exit at x2,
coin-selection-as-stop-loss via the `dcaScore ≥ 50` gate), the three zones (GOM / Chờ / Hồi), and
the **dcaScore breakdown** (market-cap tiers max 50 + weekly structure max 50, plus the
70/50/30 quality buckets). Purely informational — no data fetch, no state beyond open/close.

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
- **avgEntry** = Σusd / Σ(usd/price) — the real break-even and the base for the x2 target.
- **capitalDeployed** = Σusd, **layers** = buy count (capped at 3 in the UI — the 3-tier ladder).
- **nextAddPrice** = lastAdd × 0.85 (the backtested −15% ladder step).
- **live P&L** = (livePrice − avgEntry) / avgEntry, computed client-side from the feed's live price.

The panel shows the **x2 take-profit target**: `target = avgEntry × 2`. Amber while below (shows the
target price and the remaining % to +100%), green when livePrice ≥ target ("Đã đạt target x2 → CHỐT
TOÀN BỘ"). "Đóng vị thế" clears all buys after selling. The row's list view also shows a lightweight `dcaPosition` aggregate
(layers / avgEntry / capitalDeployed) so a holding is visible at a glance.

## Suggested gom price plan (Vùng gom gợi ý)
The DCA position tab also shows a **suggested accumulation price plan** derived from the coin's
consolidation base low (`accBaseLow`, persisted with the signal). It turns the binary GOM label into
concrete limit levels (`dcaGomPlan` in `@app/core`):
- **Entry band** = base low → base low × 1.08 (`zoneLow`–`zoneHigh`) — the price range where the GOM
  trigger actually fires (`lowZonePct` = 0.08).
- **3-tier ladder** = `[zoneHigh, zoneHigh×0.85, zoneHigh×0.85²]` — the backtested −15% spacing
  (`claude-backtest/runs/2026-07-12-bottom-dca-x2x3-merged.md`).
- **avgCost** = harmonic mean of the ladder (equal-USD tranches), **targetX2** = avgCost × 2.

The block is advisory: the −15% step is the strategy's fixed spacing, **not** a swept optimum, and the
UI labels it as such. It complements `nextAddPrice` (which anchors to the user's *actual* last buy);
the plan is the pre-trade suggestion, `nextAddPrice` is the live next-add once buying has started.

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
- Adding a buy is blocked in the UI once 3 layers are reached (the 3-tier ladder cap).
- **Stale rows scanned before 2026-07-12** carry `accZone = null` (or the old dd 40–70% band) → the DCA
  cell zone shows "—" until the next 4h scan recomputes with the dd 50–85% config.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/accumulation-signal.ts` — `computeAccumulationSignal` (the displayed `accZone`; dd 50–85% + base + RSI + `dcaScore≥50` gate; exposes `baseLow`) + `dcaGomPlan` (suggested entry band + −15% ×3 ladder + x2 target)
- `packages/core/src/analysis/accumulation-signal.spec.ts` — accumulation + `dcaGomPlan` unit tests
- `packages/db/prisma/migrations/20260712120000_add_signal_acc_base_low/migration.sql` — `accBaseLow` column
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `DcaPositionPanel` renders the "Vùng gom gợi ý" block
- `packages/core/src/analysis/dca-signal.ts` — `computeDcaScore` (survival score) + legacy `dcaZone` (dip-buy, no longer displayed)
- `apps/web/src/app/accumulation/page.tsx` — redirect stub → `/tracking-coins` (page merged 2026-07-12)
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
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `DcaCell`, `CoinDetailModal` (hosts the `DCA position` tab), `DcaPositionPanel`, `StrategyInfoDialog` (header info dialog), sort/column
- `apps/web/src/app/globals.css` — `.tc-dca*`, `.tc-zone*`, `.dcapos-*`, `.si-*` (strategy info dialog) styles
