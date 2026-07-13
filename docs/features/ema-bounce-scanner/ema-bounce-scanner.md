## Description
The **EMA Bounce Scanner** (`/ema-bounce`) is a stateful watchlist scanner for the
"extended-below-EMA-stack oversold StochRSI bounce" LONG strategy. The user maintains a
coin watchlist; the worker auto-scans it on **two timeframes** — **4H** (right after each
4h candle closes) and **D1** (once daily) — and for any coin that satisfies the rule it
**persists a signal card** (tagged with the scan timeframe) and **sends a text Telegram
alert**. Cards are **outcome-tracked**: each scan refreshes the open card's current price /
PnL% and closes it as `hit_tp` once price reaches the +10% target. Signals are keyed by
`(coin, timeframe, candle-close)`, so the same coin can have both a 4H and a D1 card.

Entry rule (shared with the `/strategy-test` backtest strategy via
`detectEmaStackOversoldEntry` in `@app/core`), evaluated on the last CLOSED 4h candle:
1. Price below a bearish EMA stack: `close < EMA34 < EMA89 < EMA200`
2. Price stretched 7–15% below EMA34: `(EMA34−close)/EMA34 ∈ [0.07, 0.15]`
3. StochRSI(14/14/3/3) bullish cross in oversold: `%K` crosses above `%D` while `%K < 20`

TP = +10%. **No stop-loss** (per the user's rule — the card just tracks until TP or stays open).

> ⚠ Backtest (`claude-backtest/runs/2026-07-13-…`): the no-SL rule has ~80% TP-hit but
> negative expectancy — this scanner surfaces the setups; risk sizing is the user's call.

## Main Flow
1. User opens `/ema-bounce`, adds coins (`POST /ema-bounce/coins`, symbol upper-cased and
   any `USDT` suffix stripped) or removes them (`DELETE /ema-bounce/coins/:symbol`).
2. **Worker crons** — `runEmaStochScan4h` (`@Cron('0 2 */4 * * *')` UTC → 00:02, 04:02, …)
   calls `scanAll('4h')`; `runEmaStochScanD1` (`@Cron('0 5 0 * * *')` UTC → 00:05 daily) calls
   `scanAll('1d')`. For each watched coin `scanOne` fetches 300 klines of that timeframe, drops
   the still-forming candle (`closeTime > now`), and runs the detector on the last closed candle.
3. On a match it calls `repo.createSignalIfNew(coinId, { timeframe, … })` — idempotent on
   `(coinId, timeframe, triggeredAt)` so re-running a scan never double-alerts. If newly created
   it sends a text Telegram message that includes the timeframe label (4H / 1D).
4. It then refreshes that coin's OPEN cards **for the same timeframe**
   (`findOpenSignalsByCoinAndTimeframe`): computes max high since the trigger; if `≥ tpPrice`
   → `markSignalHitTp` (+10% locked), else `updateSignalMark` (currentPrice/pnlPct).
5. The page (`ema-bounce-page.tsx`) server-loads the watchlist (`GET /ema-bounce/coins`) and
   cards (`GET /ema-bounce/signals`) and renders the client widget: watchlist manager, a
   "Quét ngay" live preview, and a grid of outcome-tracked signal cards (status badge, entry,
   current, PnL%, TP, distance below EMA34, RSI, StochRSI).
6. **Live preview** (`POST /ema-bounce/preview`) runs the same detector on-demand on **both**
   the 4H and 1D timeframes without persisting or alerting — each match is tagged with its
   timeframe, giving immediate feedback before the next cron.

## Edge Cases
- **Forming candle** — klines are filtered to `closeTime ≤ now` so the detector never uses the
  currently-forming 4h candle (no repaint). `triggeredAt` = the closed candle's close time.
- **Duplicate alerts** — `createSignalIfNew` is idempotent on `(coinId, triggeredAt)`; a re-run
  (or a scan that overlaps the same candle) returns `{ created: false }` and sends no Telegram.
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
- `packages/core/src/analysis/ema-stack-oversold.ts` — `detectEmaStackOversoldEntry` + config/const
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
