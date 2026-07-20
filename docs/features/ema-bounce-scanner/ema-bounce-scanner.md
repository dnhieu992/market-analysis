## Description
The **EMA Bounce Scanner** (`/ema-bounce`) is a stateful watchlist scanner for the
"extended-below-EMA-stack oversold StochRSI bounce" LONG strategy. The user maintains a
coin watchlist; the worker auto-scans it on **two timeframes** — **4H** (right after each
4h candle closes) and **D1** (once daily). Its purpose is **early monitoring**: surface
coins that are *about to* qualify (not only ones that already do) so the user can eyeball
the chart before deciding to enter.

Each watched coin gets **at most one open card per timeframe**, carrying a **0–100 score**
and walking a **stage lifecycle** `near → reach → risk`, then closing as `hit_tp`. Cards are
outcome-tracked: each scan refreshes current price / PnL% / recomputed score, advances the
stage, and closes as `hit_tp` at the +10% target. Cards are keyed by `(coin, timeframe,
candle-close)`, so a coin can have both a 4H and a D1 card.

**Telegram is selective** (creation gate is loose, so cards are many): an alert fires only
when a card is created/updated to **score ≥ 70** (`ALERT_MIN_SCORE`), or on a `reach` / `risk`
transition. Low-score cards are **page-only**. A never-reached `near` card whose setup fully
faded (no signal condition left, not in profit) is **expired** so the page stays clean.

**Detectors in `@app/core`** (evaluated on the last CLOSED candle):
- `detectEmaStackOversoldEntry` — the *strict* entry (unchanged), shared with the
  `/strategy-test` backtest. Fires only on the exact cross candle.
- `scoreEmaStackOversoldSetup` — the **scanner detector** the page/worker use now. Instead
  of gating on ALL conditions, it surfaces any coin **below EMA34** that meets **at least
  one** signal condition and returns a **0–100 weighted completeness score** so partial
  setups can be ranked. Weighted points (partial credit for "gần"):
  - Bearish EMA stack (`EMA34<89<200`) — **15**
  - Stretched below EMA34 — **20** at 7–15%, **10** at 5–7% / 15–18%
  - StochRSI oversold — **20** at `%K<20`, **10** at `%K<30`
  - StochRSI cross — **25** fresh bullish cross in oversold (within 3 candles, not run > 5%),
    **12** about-to-cross (`%D−%K ≤ 6`, `%K<20`)
  - **Price action — 20** (see below)

  `stage = reach` when the full strict entry is present (stack + 7–15% + fresh cross), else
  `near` — **PA does not affect the stage**. Returns `null` when price is not below EMA34, or
  no signal condition is met (a plain downtrend never produces a card). Weights live in
  `EMA_STACK_SCORE_WEIGHTS`.

### The price action block (20đ)

This setup is by construction a LONG bought **into a downtrend** (price under EMA34, bearish
stack), so the entry timeframe's own PA trend is ~always `Down` and carries no information —
scoring it would subtract a constant from every card. The two PA reads that actually separate
a bounce from a falling knife, and that the block scores:

| Read | Max | Points |
|------|-----|--------|
| **`htfTrend`** — trend of the timeframe ABOVE the setup (a **4H** card is read against **D1**, a **1D** card against **W1**) | 12 | `StrongUp` 12 · `Up` 10 · `Neutral` 6 · `Down` 3 · `StrongDown` 0 |
| **`swingStructure`** — the entry timeframe's own HH/HL structure | 8 | `HH_HL` 8 · `LH_HL` 6 · `Mixed` 4 · `HH_LL` 2 · `LH_LL` 0 |

Both come from `computeTimeframeStructure` (`@app/core`) — the same 1-bar-pivot maths
`/tracking-coins` uses for `trend` / `weekTrend`, so the two pages read structure identically.
The idea mirrors `computeEntryScore`'s multi-timeframe alignment, applied to a bounce: a dip
bought while the higher timeframe still trends up is a **pullback**; the same dip under a
collapsing HTF is a **knife**. `LH_LL` means price is still printing lower lows (the downtrend
has not stopped); `LH_HL` means a higher low — a base forming, which is what a bounce needs.

**PA is context that ranks, not a reason to surface.** It is deliberately excluded from the
"at least one signal condition" gate, and a bad HTF is **not** a hard gate (unlike
`/tracking-coins`, which gates `d1Trend` Down/StrongDown to `entryScore = 0`). A knife still
gets a card — it just scores too low to clear `ALERT_MIN_SCORE`, keeping the scanner's wide-net
"early monitoring" design intact. Points tables: `EMA_STACK_HTF_TREND_POINTS` /
`EMA_STACK_STRUCTURE_POINTS`; `formatEmaStackPa` renders the one-line Telegram summary.

> **Measured on 43 live cards (40 coins × 4H/1D, 2026-07-17):** the block discriminates rather
> than shifting everything — PA totals span all 11 values 0–20 (median 6). **44% of cards sit
> against a `StrongDown` HTF** (37% Neutral, 19% Up/StrongUp), i.e. nearly half of what the
> scanner surfaces is knife-catching. Alerts (≥70đ) went **3 → 1**: HBAR 1D `70đ → 55đ`
> (W1 StrongDown, PA 0/20) and ICP 4H `75đ → 66đ` (PA 6/20) fell silent, while good-PA bounces
> re-ranked up (AXS/ENJ 4H `45đ → 53đ`, PA 18/20). Since median PA is 6/20, the effective
> alert bar rose — if Telegram gets too quiet, lower `ALERT_MIN_SCORE` rather than reweighting.
- `detectEmaStackOversoldSignal` — the earlier binary near/reach detector, kept exported but
  no longer used by the scanner (superseded by the scored version).

**Stage `risk`** is set during tracking (not by the detector): once an open card's price
reaches within **2%** of its +10% TP (`RISK_BAND`), it advances to `risk` — a heads-up that
price is near target. Stage advance is **monotonic** (`near`(0) < `reach`(1) < `risk`(2)),
so a card never falls back and each rank increase alerts exactly once.

TP = +10%. **No stop-loss** (per the user's rule — the card just tracks until TP or stays open).

> ⚠ Backtest (`claude-backtest/runs/2026-07-13-…`): the no-SL rule has ~80% TP-hit but
> negative expectancy — this scanner surfaces the setups; risk sizing is the user's call.

## Main Flow
1. User opens `/ema-bounce`, adds coins (`POST /ema-bounce/coins`, symbol upper-cased and
   any `USDT` suffix stripped) or removes them (`DELETE /ema-bounce/coins/:symbol`).
2. **Worker crons** — `runEmaStochScan4h` (`@Cron('0 2 */4 * * *')` UTC → 00:02, 04:02, …)
   calls `scanAll('4h')`; `runEmaStochScanD1` (`@Cron('0 5 0 * * *')` UTC → 00:05 daily) calls
   `scanAll('1d')`. For each watched coin `scanOne` fetches 300 klines of that timeframe, drops
   the still-forming candle (`closeTime > now`), fetches 200 klines of the **higher timeframe**
   (`HTF_OF`: 4h→1d, 1d→1w) for the PA trend, and runs the scored detector on the last closed
   candle.
3. `scanOne` first **refreshes + advances** the coin's existing OPEN cards for this timeframe
   (`findOpenSignalsByCoinAndTimeframe`): computes max high since the trigger; if `≥ tpPrice`
   → `markSignalHitTp` (+10% locked). Otherwise `updateSignalMark` (currentPrice/pnlPct), then
   computes the next stage — `risk` if price is within 2% of TP, else `reach` if the detector
   now returns `reach` — and, when the stage rank increases, `updateSignalStage` + a labeled
   Telegram alert for that transition.
4. If the coin has **no open card** for this timeframe and the detector fired, it calls
   `repo.createSignalIfNew(coinId, { stage, note, … })` — idempotent on `(coinId, timeframe,
   triggeredAt)` — creating one card at its detected stage (`near` or `reach`) and sending the
   matching Telegram alert (`⏳ GẦN THOẢ MÃN` / `🟢 THOẢ MÃN`; `risk` transitions send `🔔 GẦN TP`).
5. The page (`ema-bounce-page.tsx`) server-loads the watchlist (`GET /ema-bounce/coins`) and
   cards (`GET /ema-bounce/signals`) and renders the client widget: watchlist manager, a
   "Quét ngay" live preview, and a grid of cards. Each card's badge shows the stage (or the
   closed status), plus the reason `note`, entry/current/PnL%, TP, distance below EMA34, RSI,
   StochRSI. Filters: stage, timeframe, open-only.
6. **Live preview** (`POST /ema-bounce/preview`) runs the same scanner detector on-demand on
   **both** the 4H and 1D timeframes without persisting or alerting — each match is tagged with
   its timeframe, stage, and note, giving immediate feedback before the next cron.
7. **View chart** — every signal card and preview match has a **📈 Xem chart** button. It opens
   a fullscreen dialog (portalled to `<body>` so card backdrop-filters can't trap it) showing a
   server-rendered PNG from `GET /ema-bounce/chart`. The chart mirrors the daily-plan visual
   pipeline (candlesticks + S/R + current-price line via `chartjs-node-canvas`) but is tuned to
   this strategy: **EMA34/89/200** (the stack the setup uses) plus dashed **Entry** and **TP +10%**
   lines, a **StochRSI(14,14,3,3) pane** below price (%K blue / %D orange, 20/80 zones) — the
   same oscillator the scanner triggers on — and, stacked below it, a **QQE(14,5,4.236) pane**
   (smoothed-RSI `RSI-MA` in purple + the trailing `Signal` line in teal; RSI-MA crossing above the
   signal = bullish, below = bearish; 50 mid-line). The chart is rendered light-mode (white background).
   The visible window (~140 candles) is **centered on the setup candle** (`focusTime` =
   the card's `triggeredAt`) with a faint highlight band on that candle, so the "vùng giá thoả
   mãn" sits in the middle. Preview matches (which happen "now") have no `focusTime`, so they show
   the most recent candles instead.

## Chart endpoint
`GET /ema-bounce/chart?symbol=&timeframe=&focusTime=&entry=&tp=` → `image/png` (auth-protected
like all routes). `symbol` is normalized (`USDT` suffix optional); `timeframe` is `4h` or `1d`.
`focusTime` (ms) centers the window on the matching candle (nearest open ≤ focusTime); when
omitted or out of range the latest candles show. `entry`/`tp` draw the dashed plan lines. EMAs
are computed on the full 300-candle fetch then sliced to the display window so they stay accurate
at the left edge. Served as a `StreamableFile` (no `express` type dependency needed).

## Edge Cases
- **Forming candle** — klines are filtered to `closeTime ≤ now` so the detector never uses the
  currently-forming 4h candle (no repaint). `triggeredAt` = the closed candle's close time.
- **Duplicate alerts** — `createSignalIfNew` is idempotent on `(coinId, triggeredAt)`; a re-run
  (or a scan that overlaps the same candle) returns `{ created: false }` and sends no Telegram.
- **One card per coin+timeframe** — a fresh card is only created when there is NO open card for
  that coin+timeframe. A `near` watch therefore flips **in place** to `reach` (and later `risk`)
  rather than spawning a second card, so the page never shows duplicate cards for one setup.
- **Stage never regresses** — `STAGE_RANK` gates transitions so a card can only advance; a
  StochRSI un-cross or a dip back below the strict band won't drop a `reach` card back to `near`.
- **Late/missed entry** — if a StochRSI cross already ran > 5% past its cross close, the detector
  returns `null` (not surfaced fresh); an already-open card keeps tracking toward TP regardless.
- **Too-short history** — coins with fewer than `EMA_STACK_OVERSOLD_MIN_CANDLES` (~236) closed
  4h candles are skipped (EMA200 + StochRSI warm-up).
- **Forming higher-TF candle** — the HTF fetch is filtered to `closeTime ≤ now` too, so a 4h
  scan at 04:02 reads yesterday's closed D1, never the D1 candle still forming. No repaint.
- **Too-short HTF history** — a coin with fewer than 20 closed W1 candles (a young listing on a
  1D card) scores `htfTrend = 'Neutral'` (6/12), not 0 — absent history must not read as bearish.
- **PA on pre-existing cards** — `htfTrend` / `swingStructure` are nullable; cards created before
  the PA migration render without the PA row until the next scan refreshes them (`updateSignalMark`
  rewrites both every scan, since PA moves while a card is open).
- **Note overflow** — `note` is `VARCHAR(255)` and PA appends two more reasons, so the worker
  clamps the joined reasons via `noteOf()` before persisting.
- **Extra Binance calls** — the HTF read doubles fetches per coin (2 → 4 in the preview, which
  scans both timeframes). Acceptable for a hand-maintained watchlist; revisit if it grows large.
- **TP over multiple candles** — TP-hit is detected from the max high of all candles closed
  after the trigger, so a target reached between two 4h scans is still caught.
- **No Telegram chat id** — `notify()` no-ops when `TELEGRAM_CHAT_ID` is empty; a send failure
  is caught and logged, never breaking the scan (non-fatal pattern).
- **Per-coin fetch failure** — caught, counted in `failed`, scan continues for the rest.
- **Coin removed** — `EmaStochSignal.coin` FK is `onDelete: Cascade`, so its cards are removed too.

## Related Files (FE / BE / Worker)
- `packages/core/src/indicators/stoch-rsi.ts` — `calculateStochRsi` (TradingView 14/14/3/3)
- `packages/core/src/analysis/ema-stack-oversold.ts` — strict `detectEmaStackOversoldEntry` + the scanner's `detectEmaStackOversoldSignal` (near/reach + note) + `scoreEmaStackOversoldSetup` (**PA block**) + `formatEmaStackPa` + config/const
- `packages/core/src/analysis/ema-stack-oversold.spec.ts` — PA block tests (HTF ranks monotonically, PA can't surface a coin alone, PA can't change the stage)
- `packages/core/src/analysis/small-cap-signal.ts` — `computeTimeframeStructure` (trend **+ swingStructure**, shared with `/tracking-coins`); `computeTimeframeTrend` now delegates to it
- `packages/db/prisma/migrations/20260717120000_ema_stoch_signal_pa_trend/migration.sql` — adds nullable `htfTrend` + `swingStructure` columns
- `packages/db/prisma/migrations/20260714120000_ema_stoch_signal_stage/migration.sql` — adds `stage` (default `reach`) + `note` columns
- `packages/db/prisma/migrations/20260714140000_ema_stoch_signal_score/migration.sql` — adds the `score` (0–100) column
- `packages/core/src/index.ts` — exports the detector/indicator
- `packages/db/prisma/schema.prisma` — `EmaStochWatchCoin` + `EmaStochSignal` models
- `packages/db/prisma/migrations/20260713150000_add_ema_stoch_scanner/migration.sql` — tables
- `packages/db/prisma/migrations/20260713170000_ema_stoch_signal_timeframe/migration.sql` — adds `timeframe` + `(coinId, timeframe, triggeredAt)` unique (creates the new index *before* dropping the old one, which backs the coinId FK)
- `packages/db/src/repositories/ema-stoch-scanner.repository.ts` — watchlist + signal CRUD/outcome
- `packages/db/src/index.ts` — exports `createEmaStochScannerRepository`
- `apps/worker/src/modules/ema-stoch-scan/ema-stoch-scan.service.ts` — 4h scan, persist, Telegram, outcome tracking
- `apps/worker/src/modules/ema-stoch-scan/ema-stoch-scan.module.ts` — module wiring (Market + Telegram)
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `runEmaStochScan` cron (`0 2 */4 * * *` UTC)
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — imports `EmaStochScanModule`
- `apps/api/src/modules/ema-stoch-scanner/*` — controller/service/dto (coins CRUD, signals, preview, **chart PNG**)
- `apps/api/src/modules/ema-stoch-scanner/chart-renderer.ts` — `chartjs-node-canvas` renderer (EMA34/89/200 + S/R + Entry/TP + focus band + StochRSI pane + QQE pane via a shared `buildOscillatorPane` drawer)
- `packages/core/src/indicators/qqe.ts` — `calculateQqe` (smoothed-RSI fast line + Wilder-ATR trailing signal line), exported from `@app/core`
- `apps/api/package.json` — adds `chart.js` + `chartjs-node-canvas` deps for the chart endpoint
- `apps/api/src/app.module.ts` — registers `EmaStochScannerModule`
- `apps/web/src/app/ema-bounce/page.tsx` — App Router route (thin re-export)
- `apps/web/src/_pages/ema-bounce-page/ema-bounce-page.tsx` — server page, loads watchlist + signals
- `apps/web/src/widgets/ema-bounce/ema-bounce-feed.tsx` — client UI (card grid, preview); watchlist is managed via the "Quản lý coin" `ManageCoinsDialog` (add input + delete list) and the feed can be filtered by coin(s) through the `CoinMultiSelect` checkbox dropdown
- `apps/web/src/widgets/ema-bounce/ema-bounce-feed.tsx` — also hosts `ChartDialog` (fullscreen chart, portalled to `<body>`) + the "📈 Xem chart" buttons, and `InfoDialog` (the "cách hoạt động" explainer opened by the ⓘ icon next to the page title)
- `apps/web/src/shared/api/client.ts` — `fetchEmaBounceCoins`, `addEmaBounceCoin`, `removeEmaBounceCoin`, `fetchEmaBounceSignals`, `previewEmaBounce`, `resolveApiBaseUrl` (builds the chart image URL)
- `apps/web/src/shared/api/types.ts` — `EmaBounceCoin`, `EmaBounceSignal`, `EmaBounceMatch`, `EmaBouncePreview`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — sidebar nav entry
- `apps/web/src/app/globals.css` — `.eb-*` styles
- `apps/worker/test/stubs/app-db.ts` — jest stub for `createEmaStochScannerRepository` (keeps worker AppModule bootstrap test green)
