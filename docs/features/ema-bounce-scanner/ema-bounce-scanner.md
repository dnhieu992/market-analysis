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
  - Bearish EMA stack (`EMA34<89<200`) — **20**
  - Stretched below EMA34 — **25** at 7–15%, **12** at 5–7% / 15–18%
  - StochRSI oversold — **25** at `%K<20`, **12** at `%K<30`
  - StochRSI cross — **30** fresh bullish cross in oversold (within 3 candles, not run > 5%),
    **15** about-to-cross (`%D−%K ≤ 6`, `%K<20`)

  `stage = reach` when the full strict entry is present (stack + 7–15% + fresh cross), else
  `near`. Returns `null` when price is not below EMA34, or no signal condition is met (a
  plain downtrend never produces a card). Weights live in `EMA_STACK_SCORE_WEIGHTS`.
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
   the still-forming candle (`closeTime > now`), and runs `detectEmaStackOversoldSignal` on the
   last closed candle.
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
- **TP over multiple candles** — TP-hit is detected from the max high of all candles closed
  after the trigger, so a target reached between two 4h scans is still caught.
- **No Telegram chat id** — `notify()` no-ops when `TELEGRAM_CHAT_ID` is empty; a send failure
  is caught and logged, never breaking the scan (non-fatal pattern).
- **Per-coin fetch failure** — caught, counted in `failed`, scan continues for the rest.
- **Coin removed** — `EmaStochSignal.coin` FK is `onDelete: Cascade`, so its cards are removed too.

## Related Files (FE / BE / Worker)
- `packages/core/src/indicators/stoch-rsi.ts` — `calculateStochRsi` (TradingView 14/14/3/3)
- `packages/core/src/analysis/ema-stack-oversold.ts` — strict `detectEmaStackOversoldEntry` + the scanner's `detectEmaStackOversoldSignal` (near/reach + note) + config/const
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
- `apps/api/src/modules/ema-stoch-scanner/*` — controller/service/dto (coins CRUD, signals, preview)
- `apps/api/src/app.module.ts` — registers `EmaStochScannerModule`
- `apps/web/src/app/ema-bounce/page.tsx` — App Router route (thin re-export)
- `apps/web/src/_pages/ema-bounce-page/ema-bounce-page.tsx` — server page, loads watchlist + signals
- `apps/web/src/widgets/ema-bounce/ema-bounce-feed.tsx` — client UI (watchlist, preview, card grid)
- `apps/web/src/shared/api/client.ts` — `fetchEmaBounceCoins`, `addEmaBounceCoin`, `removeEmaBounceCoin`, `fetchEmaBounceSignals`, `previewEmaBounce`
- `apps/web/src/shared/api/types.ts` — `EmaBounceCoin`, `EmaBounceSignal`, `EmaBounceMatch`, `EmaBouncePreview`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — sidebar nav entry
- `apps/web/src/app/globals.css` — `.eb-*` styles
- `apps/worker/test/stubs/app-db.ts` — jest stub for `createEmaStochScannerRepository` (keeps worker AppModule bootstrap test green)
