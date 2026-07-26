## Description
> **Signal computation removed (2026-07-26, refactor step 1).** The scan that produced `dcaScore`,
> `accZone` and the per-timeframe indicators no longer runs — the page now reads the last stored
> signal and the displayed values are frozen until the new flow lands. Scoring logic stays in
> `@app/core`. See `docs/features/tracking-coins-signal-refactor/`.

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
1. ~~Daily/manual scan (`TrackingCoinScanService` worker, `TrackingCoinsService.scanOneCoin` API)
   builds the D1/H4/W1 signal and computes `low20Pct` (% above the rolling 20-day low).~~ **Removed
   2026-07-26** — no signal is written any more.
2. ~~`computeDcaScore` (`@app/core`) scores survival from `marketCap` (max 50) + weekly trend/EMA/UTBot
   (max 50). Persisted as `dcaScore`, with `low20Pct`, on `TrackingCoinSignal`.~~ Logic kept in
   `@app/core`, no longer invoked.
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

## DCA position tracking (the position IS the portfolio)
> **Rewritten 2026-07-26 (refactor step 2).** There is no separate DCA store any more. The
> `tracking_coin_dca_buys` table and the mirror/sync machinery around it are **dropped**; the position
> is read straight out of the portfolio configured on the coin (`TrackingCoin.dcaPortfolioId`). The DCA
> tab and `/portfolio` therefore cannot disagree by construction — there is only one set of numbers.

The **DCA position** tab inside the coin detail modal is a **view over that portfolio's `Holding` +
`CoinTransaction` rows** for the symbol. Clicking the layers icon in the row actions (which shows the
capital deployed when holding) opens the same detail modal used by a row click, with the tab
pre-selected. Everything shown is derived from the portfolio:

- **amount** = `Holding.totalAmount` — the coin units actually held.
- **avgEntry** = `Holding.avgCost` — the portfolio's cost basis, the real break-even and the base for
  the x2 target (`targetX2` = avgEntry × 2).
- **capitalDeployed** = `Holding.totalCost`, **realizedPnl** = `Holding.realizedPnl` (booked profit
  from earlier sells, shown once non-zero).
- **buyCount / sellCount** = the coin's live (non-soft-deleted) transactions in that portfolio.
- **nextAddPrice** = lastBuy × 0.85 (the backtested −15% ladder step) — **advisory only**.
- **live P&L** = (livePrice − avgEntry) / avgEntry, computed client-side from the feed's live price.

The panel shows the **x2 take-profit target**. Amber while below (target price + remaining % to
+100%), green when livePrice ≥ target ("Đã đạt target x2 → CHỐT TOÀN BỘ"). The row's list view shows a
lightweight `dcaPosition` aggregate (amount / avgEntry / capitalDeployed) from the same holding, so a
position is visible at a glance without opening the modal.

**No layer cap.** The old 3-layer ceiling (`dcaMaxLayers`, default 3) and its "Đã đạt trần" block are
gone — the −15% ladder is a price suggestion, not a quota, so buying is never disabled. The 3-tier
"Vùng gom gợi ý" plan below is still the pre-trade suggestion.

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

## Trading from the tab (writes real portfolio transactions)
`symbol` ≡ portfolio `coinId`, both bare (e.g. `BTC`). Every action writes a real transaction — there
is nothing to keep in sync, because there is no second copy.

- **Portfolio is configured per coin.** The ⚙ button in the Actions column opens `CoinSettingsDialog`
  → pick the portfolio the coin's position lives in, stored on `TrackingCoin.dcaPortfolioId`
  (replaced the old `localStorage` `dca-portfolio:<symbol>` per-buy dropdown). The DCA tab only
  **displays** it, read-only. Without it there is nowhere to write, so the tab renders a notice
  pointing at ⚙ instead of the position, and `+ Gom` / sell are unavailable.
- **+ Gom → BUY.** `addDcaBuy(symbol, {price, usd}, userId)` resolves the portfolio from the coin,
  validates ownership (`PortfolioService.getPortfolio`), then creates a BUY `CoinTransaction`
  (`amount = usd / price`, fee 0, note `DCA gom (tracking-coins)`) → the holding recomputes and the
  fresh position is returned. Rejects a missing portfolio or non-positive price/usd with 400.
- **Bán → SELL (partial or full).** `POST /dca-sell` with optional `price` (defaults to the live
  Binance price) and optional `amount` (defaults to **everything held**). The dialog offers 25/50/75%
  and "Tất cả" quick-fills and previews proceeds + PnL before confirming. The amount is clamped to the
  held amount so float drift cannot trip the holding's "only X available" guard; the SELL deducts from
  the holding and books `realizedPnl` normally.
- **Delete layer = delete the transaction.** `DELETE /dca-buys/:transactionId` soft-deletes that
  `CoinTransaction` and recalculates the holding (confirmation prompt in the UI, since it moves the
  average). Deleting the same transaction from the portfolio UI removes it from this tab too — not via
  a reverse-sync hook any more, but because both read the one transaction list.

## Activity logs (2026-07-26)
The coin detail modal's third tab, `ActivityLogPanel` — a per-coin timeline modelled on the Bitget
trade journal (`BitgetJournalDrawer`), reusing its `.bgj-*` styles. It replaces the two tabs it
supersedes: **History** (the signal change-log, dead since the scan was removed) and **Journal**
(per-date free text, 0 rows in production) — both deleted, along with the `tracking_coin_journals`
table. `TrackingCoinSignalHistory` rows are untouched: the signal rebuild still owns that data.

- **Manual notes** — TipTap markdown editor, Claude reformats on save (`reformatJournal`, shared with
  the Bitget/orders journals), image upload to R2. Editable and deletable.
- **System entries** — written by the API, read-only (`PATCH`/`DELETE` reject `kind: 'system'`). Only
  **two events are logged, both driven by a real trade action** — deliberately no time-based or
  price-milestone tracking, since a moving `avgEntry` makes %-from-entry milestones retroactively wrong:
  - 🟢 **BUY** (`addDcaBuy`) — which buy it is (`lệnh mua thứ N`, no cap), price paid, `avgEntry` and the
    x2 target *after* the buy, amount now held and total deployed, plus `SIGNAL`/`FOMO` with the
    RSI/`dcaScore` at that instant (the part a later scan would overwrite).
  - 🔴 **SELL** (`sellDcaPosition`) — 🔴 "Đóng vị thế" on a full exit, 🟡 "Chốt một phần (N%)" otherwise:
    exit price, units sold and proceeds, `avgEntry`, PnL % and USD **on the sold portion**, then either
    buys used + days held (full) or units remaining (partial), and whether the x2 target was reached.
- **Idempotency** — `refId` is `UNIQUE` and is now the **`CoinTransaction.id`** of the BUY or SELL that
  the entry describes, so a retried write can never duplicate a line — and every entry points at a
  transaction that still exists. A failed log is warned and never rolls back the trade.
- **Keyed by `symbol`**, not a coin FK — the log survives removing and re-adding a coin.
- Every entry carries a `snapshot` (`price`, `avgEntry`, `layers`, `capitalDeployed`, `pnlPct`) frozen
  at write time; manual notes get theirs from the live position when saved.

## Edge Cases
- **Micro-cap / unknown market cap** → 0 cap points → can never reach "An toàn" (high death risk).
- **Missing signal** (never scanned) → DCA cell shows "—".
- **Null RSI** in zone derivation defaults to 50 (treated as not-oversold → not GOM).
- **Flat / nothing held** → `dcaPosition` is null; the action button shows the layers icon, not a
  figure. The tab still lists past transactions (so a closed position's history stays readable) but
  hides the x2 target line and the Bán button.
- **No layer cap** — buying is never blocked on a count; only price/USD > 0 and a configured portfolio.
- **Coin has no configured portfolio** → the DCA tab shows a notice pointing at the ⚙ Actions dialog
  instead of the position, and the API rejects buy/sell/delete with 400. Nothing is stored locally as a
  fallback, because a buy log the portfolio does not know about is exactly what this refactor removed.
- **No portfolios exist at all** → the ⚙ dialog's select is disabled with a "Chưa có portfolio" note.
- **Changing the portfolio later** re-points the tab at the new portfolio: the position shown becomes
  whatever that portfolio holds in the coin. Past transactions stay in the old portfolio (they are real
  trades) — the activity timeline, keyed by symbol, keeps the full narrative either way.
- **Transferring the coin between portfolios** (`/portfolio` transfer) moves `dcaPortfolioId` along
  with it, so the tab follows the coin instead of pointing at the now-empty source.
- `PUT /setup` is a **partial** update — only keys present in the body are written, so the ⚙ dialog
  cannot wipe the swing/daytrade risk fields.
- **Selling more than held** → clamped to the held amount server-side; the dialog also blocks it
  client-side with "Chỉ còn X ... trong portfolio".
- **Sell with no obtainable price** (Binance fetch fails and no manual price) → 400, no transaction:
  a PnL computed against price 0 would be a lie in both the holding and the permanent log.
- **Deleting a transaction writes no activity entry** — the original BUY/SELL line stays, so the
  timeline still shows it happened. The position summary is the source of truth for what is held now.
- **Activity logs survive coin removal** — re-adding the symbol later brings the old timeline back.
- **No scan since 2026-07-26** → every indicator/score on the page is a frozen snapshot of the last
  scan; the Overview footer timestamp shows how old it is.
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
- `packages/db/prisma/schema.prisma` — `TrackingCoinSignal.dcaScore`/`low20Pct`, `TrackingCoin.dcaPortfolioId` (no DCA-buy model any more)
- `packages/db/prisma/migrations/20260626140000_tracking_coin_dca_score/migration.sql`
- `packages/db/prisma/migrations/20260726160000_dca_position_from_portfolio/migration.sql` — **drops `tracking_coin_dca_buys` + `dcaMaxLayers`** (every surviving row carried a `transactionId`, so the portfolio already holds the full position)
- `packages/db/src/repositories/tracking-coins.repository.ts` — `findHoldingsForPairs` (one query for every tracked coin's holding) + `findCoinTransactions`
- ~~`apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts`~~ — deleted 2026-07-26
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — stored-signal read + zone derivation + `dcaContext`/`getDcaPosition` (portfolio-derived) + `addDcaBuy`/`sellDcaPosition`/`deleteDcaBuy` writing real transactions via `TransactionService`, ownership via `PortfolioService`, holding read via `HoldingsService`
- `apps/api/src/modules/tracking-coins/tracking-coins.module.ts` — imports `TransactionModule`/`PortfolioModule`/`HoldingsModule`
- `apps/api/src/modules/transaction/transaction.service.ts` — `removeTransaction` (no DCA mirror to clean up any more)
- `apps/api/src/modules/holdings/holdings.service.ts` — `getHolding` (raw holding row: `totalAmount`/`avgCost`/`totalCost`/`realizedPnl`), `transferCoin` moves `dcaPortfolioId` with the coin
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — `GET dca-position`, `POST dca-buys`, `POST dca-sell`, `DELETE dca-buys/:transactionId`
- `apps/api/src/modules/tracking-coins/dto/add-dca-buy.dto.ts` — `AddDcaBuyDto` (no `portfolioId`) + `SellDcaDto`
- `apps/web/src/shared/api/types.ts` — `dcaScore`/`dcaZone`/`low20Pct`, `dcaPosition`, `DcaPosition`/`DcaTransaction`
- `apps/web/src/shared/api/client.ts` — `fetchDcaPosition`/`addDcaBuy`/`deleteDcaBuy`/`sellDcaPosition` + `fetchTrackingCoinSetup`/`updateTrackingCoinSetup`
- `packages/db/prisma/migrations/20260726120000_add_tracking_coin_dca_portfolio/migration.sql` — `dcaPortfolioId` on `TrackingCoin`
- `apps/api/src/modules/tracking-coins/dto/update-coin-setup.dto.ts` — `dcaPortfolioId` (optional, `null` clears)
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `DcaCell`, `CoinDetailModal` (hosts the `DCA position` / `Activity logs` tabs), `DcaPositionPanel` (portfolio-derived, transaction table) + `SellDcaDialog` (partial/full sell with quick-fills and PnL preview), `CoinSettingsDialog` + ⚙ Actions button, `StrategyInfoDialog` (header info dialog), sort/column
- `apps/web/src/widgets/tracking-coins/activity-log-panel.tsx` — Activity logs timeline + composer
- `packages/db/prisma/migrations/20260726140000_add_tracking_coin_activity_logs/migration.sql` — creates `tracking_coin_activity_logs`, drops the unused `tracking_coin_journals`
- `apps/api/src/modules/tracking-coins/dto/activity-log.dto.ts` — add/update note DTOs
- `apps/web/src/app/globals.css` — `.tc-dca*`, `.tc-zone*`, `.dcapos-*`, `.tc-activity*` (Activity logs tab, reuses `.bgj-*`), `.si-*` (strategy info dialog) styles
