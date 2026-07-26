## Description
> **Portfolio link, detail tabs and row actions removed (2026-07-26, refactor step 3).** The page no
> longer touches portfolios: the DCA position tab, the Activity logs tab, the prompt-generator drawer
> and the ⚙ portfolio-config dialog are gone, the detail modal is a single read-only indicator sheet,
> and the Actions column keeps only **delete**. DB tables/columns were left untouched — see
> "Position tracking / portfolio link — REMOVED" below.

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

## Position tracking / portfolio link — REMOVED (2026-07-26, refactor step 3)
The page no longer knows anything about portfolios. Everything below was deleted in one pass:

- **`TrackingCoin.dcaPortfolioId` link** — the per-coin "which portfolio does this position live in"
  setting and its ⚙ dialog (`CoinSettingsDialog`). The **column survives in the DB** (nothing dropped,
  no migration) but nothing reads or writes it any more; `PUT /setup` no longer accepts the key.
- **DCA position tab** (`DcaPositionPanel`, `SellDcaDialog`) — the portfolio-derived position, the x2
  target line, the "Vùng gom gợi ý" ladder block, `+ Gom` / Bán / delete-a-layer. With it went
  `GET /dca-position`, `POST /dca-buys`, `DELETE /dca-buys/:transactionId`, `POST /dca-sell` and the
  `AddDcaBuyDto`/`SellDcaDto` DTOs, so the API module no longer imports `TransactionModule` /
  `PortfolioModule` / `HoldingsModule`.
- **Activity logs tab** (`ActivityLogPanel`) — the manual-note + BUY/SELL system timeline, along with
  `GET/POST /coins/:symbol/activity`, `PATCH/DELETE /activity/:id` and the repository accessors. The
  **`tracking_coin_activity_logs` table and its rows are untouched** — only the code path is gone, so
  the history is still recoverable if the feature comes back.
- **Row aggregate** `dcaPosition` (amount / avgEntry / capitalDeployed) — `listCoins` no longer joins
  holdings, so the list is one query again.
- **`HoldingsService.transferCoin`** no longer re-points `dcaPortfolioId` when a coin moves between
  portfolios; it just moves the transactions.

Trading is tracked in `/portfolio` only. `/tracking-coins` is back to being a **watchlist +
indicator dashboard**: a table of coins with their stored signal, a read-only detail modal, and add /
delete.

## Detail modal (no tabs)
Clicking a row opens `CoinDetailModal` — a single read-only sheet (`CoinOverview`): the W / D1 / H4
indicator grid (trend · UT Bot · EMA pips · RSI · Vol×), the last-scan timestamp, and a TradingView
link. The tab bar and the two other tabs are gone; there is no state in the modal beyond open/close.

## Row actions
The Actions column holds **one button: delete** (trash → `ConfirmRemoveDialog` → `DELETE
/tracking-coins/coins/:symbol`). The prompt-generator (`TrackingCoinChatDrawer`), DCA-position,
activity-log and ⚙ settings buttons were removed with their features. The **chart button stays** —
it sits in the Coin column, not in Actions, and opens `SetupChartDialog` (H4 default). That chart is
the shared Bitget renderer, so it carries the **UT Bot (10,3)** trailing stop alongside SonicR /
EMA200 / S/R / RSI / QQE — see `docs/features/bitget-setup-tab/`.


## Edge Cases
- **Micro-cap / unknown market cap** → 0 cap points → can never reach "An toàn" (high death risk).
- **Missing signal** (never scanned) → the indicator cells show "—" and the detail modal says
  "Chưa có dữ liệu chỉ báo cho coin này." (only the TradingView link is offered).
- **Null RSI** in zone derivation defaults to 50 (treated as not-oversold → not GOM).
- `PUT /setup` is still a **partial** update — only keys present in the body are written. It now
  carries the swing/daytrade risk fields only; `dcaPortfolioId` is rejected as unknown.
- **Deleting a coin** only removes the tracking row (and its signals) — it never touches portfolio
  transactions, because the page no longer owns any.
- **Orphaned data** — `TrackingCoin.dcaPortfolioId` values and `tracking_coin_activity_logs` rows are
  left in place, unread. Nothing breaks; a future rebuild can pick them up.
- **No scan since 2026-07-26** → every indicator/score on the page is a frozen snapshot of the last
  scan; the detail modal footer timestamp shows how old it is.
- **Stale rows scanned before 2026-07-12** carry `accZone = null` (or the old dd 40–70% band) →
  zone-derived values stay stale until the signal rebuild lands.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — the whole page: table + live prices +
  QQE column, `CoinDetailModal`/`CoinOverview` (no tabs), `StrategyInfoDialog`, `AddCoinForm`,
  `ConfirmRemoveDialog` and the single delete action
- `apps/web/src/_pages/tracking-coins-page/tracking-coins-page.tsx` — server page, fetches `listCoins`
- `apps/web/src/app/tracking-coins/page.tsx` — route re-export
- `apps/web/src/app/globals.css` — `.tc-*` / `.scr-*` styles (the `.dcapos-*`, `.tc-detail-tab*`,
  `.tc-activity*`, `.tt-btn--dca/--set/--ai` rules were deleted with the features; `.dcapos-table` is
  kept because the small-cap and meme radar tables still use it)
- `apps/web/src/shared/api/types.ts` — `TrackingCoinRow` (no `dcaPortfolioId` / `dcaPosition`),
  `TrackingCoinSetup`
- `apps/web/src/shared/api/client.ts` — `fetchCoinKlines`, `fetchTrackingCoinSetup` /
  `updateTrackingCoinSetup`
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — list / add / remove / klines /
  setup only
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — stored-signal read + zone
  derivation; no portfolio, transaction or holding dependency
- `apps/api/src/modules/tracking-coins/tracking-coins.module.ts` — providers: service +
  `BinanceMarketDataService` (no `TransactionModule`/`PortfolioModule`/`HoldingsModule`)
- `apps/api/src/modules/tracking-coins/dto/update-coin-setup.dto.ts` — swing/daytrade risk fields
- `apps/api/src/modules/holdings/holdings.service.ts` — `transferCoin` moves transactions only
- `packages/db/src/repositories/tracking-coins.repository.ts` — coins + signals + orders (the holding,
  transaction and activity-log accessors were removed)
- `packages/db/prisma/schema.prisma` — unchanged: `TrackingCoin.dcaPortfolioId` and
  `TrackingCoinActivityLog` still exist, simply unused (no migration in this change)
- `packages/core/src/analysis/dca-signal.ts` — `computeDcaScore` + `dcaZone` (still used to derive the
  stored signal's zone)
- `packages/core/src/analysis/accumulation-signal.ts` — `computeAccumulationSignal` + `dcaGomPlan`
  (`dcaGomPlan` is still returned by the API but nothing renders it since the DCA tab is gone)
- `packages/core/src/analysis/small-cap-signal.ts` — `computePaTrend`/`computeTimeframeTrend`
- `apps/web/src/app/accumulation/page.tsx` — redirect stub → `/tracking-coins`
- ~~`apps/web/src/widgets/tracking-coins/activity-log-panel.tsx`~~ — deleted 2026-07-26
- ~~`apps/web/src/widgets/tracking-coin-chat-drawer/tracking-coin-chat-drawer.tsx`~~ — deleted 2026-07-26
- ~~`apps/api/src/modules/tracking-coins/dto/add-dca-buy.dto.ts`, `dto/activity-log.dto.ts`~~ — deleted 2026-07-26
- ~~`apps/worker/src/modules/tracking-coin-scan/tracking-coin-scan.service.ts`~~ — deleted 2026-07-26
