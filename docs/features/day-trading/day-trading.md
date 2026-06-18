## Description
Automated 24/7 day trading signal scanner for BTCUSDT futures (Bitget). Detects multiple price action setups on the 15m chart with 1H/4H confirmation, persists signals for strategy review, and auto-updates results when TP or SL is hit. Tuned for **~1+ signal/day on average** by covering every regime (trend reversal, trend continuation, and ranging).

Built in two phases:
- **Phase 1 (current)** — uses Bitget's **public WebSocket** (no account). Streams real-time price, detects setups, and **prints/persists LONG/SHORT signals in PAPER mode — no orders are placed.**
- **Phase 2 (future)** — connect a real Bitget account and place live orders. The execution seam is isolated in `SignalExecutorService`; the detection pipeline does not change.

## Main Flow

1. **`BitgetWebSocketService`** opens a persistent connection to `wss://ws.bitget.com/v2/ws/public` (public, no key) and subscribes to:
   - `ticker` (BTCUSDT) → caches real-time price for result monitoring
   - `candle15m` (BTCUSDT) → detects 15m candle close → emits `candleClose`
   It handles ping/pong (literal `"ping"` every 25s) and reconnects with exponential backoff.
2. On `candleClose`, `DayTradingService` runs a scan (a re-entrancy guard prevents overlap).
3. Scan loads `DayTradingSettings` and checks daily guards: stop if today's signal count ≥ `maxTradesPerDay`, or today's SL_HIT count ≥ `maxLossesPerDay`.
4. Historical candle sets (50×15m, 40×1H, 30×4H) are fetched via REST (`BitgetService`) for swing-structure lookback.
5. **Trend (H4/H1)** is read from **trendlines** (no EMAs): `trendlineTrend()` finds swing pivots, then `up` = last two swing **lows rising** with price still above the projected support line; `down` = last two swing **highs falling** with price still below the projected resistance line; conflict / no clean structure → `neutral`. This mirrors a discretionary trader drawing trendlines on H4 and H1.
6. `SetupAnalyzerService` runs two detectors in quality order; the first to trigger wins for the candle:
   - **Liquidity Sweep** (reversal): 1H swing high/low swept ≥0.12%, closed back with a **bullish/bearish engulfing** at entry + volume > avg×1.15. Allowed unless 4H trend opposes. (Engulfing is **required** here — backtest: PF 0.85 → 1.29; it is NOT required for the pullback, where it hurt.)
   - **Trend Pullback** (continuation): price pulls back to the nearest M15 swing then the latest candle reclaims (bullish reclaim of the prior high / bearish reject of the prior low). SL beyond that swing. Trend gate is **asymmetric**: LONG requires **both H4 and H1 up** (tightened — the looser gate let the LONG side bleed at PF 0.93/365d); SHORT requires H4 down & H1 not up.
   - _`RANGE_FADE` and EMA-based logic were removed — range fade traded against the trend in "neutral" regimes and backtested as a heavy net loss (PF 0.61); this is a trend-following system. `BREAK_RETEST` was also removed (negative gross edge)._
7. **Dedup**: if the same setup+direction already fired within one candle window (~14 min), it is skipped.
8. **SL placement**: beyond the nearest structural swing (swept extreme, or the pullback swing low/high) + a 0.1% buffer. A **stop-distance floor** (`minStopPct`, default **0.5%**; or `atrMult`×ATR14 when set) pushes out any SL that sits closer than the floor — without it a near-zero `|entry − SL|` inflates position size (and trading fees) into several R of drag (a real blow-up source found in backtest).
9. **TP resolution**: prefer the nearest **strong S/R zone** (`srZones()` clusters 1H swing highs+lows into bands touched ≥2×) in the trade direction when its R:R ≥ `minRR`; otherwise fall back to a measured **`minRR`-multiple** target. `rrRatio` stored is the actual R:R used.
10. **Risk/volume model** (configurable): each trade risks exactly `riskPerTrade` USDT if SL is hit. Volume (BTC) = `riskPerTrade / |entry − stopLoss|` (after the floor), `positionValue = quantity × entry`. P&L realized in USD = `quantity × price move`.
11. `SignalExecutorService.execute()` — **Phase 1**: logs `🔔 TÍN HIỆU [PAPER] …` and persists the signal with `mode = PAPER`, `status = ACTIVE`. No order is placed.
12. **Result monitor** runs in **real time on every WS price tick**: `ResultMonitorService` listens to the WS `price` event and evaluates the cached ACTIVE signals against each tick, marking `TP_HIT` / `SL_HIT` as close to the actual touch as the public feed allows.
    - **Break-even management**: once price reaches **+1R** (using the original stop distance), the stop is moved to the entry price and `breakEvenMoved` is set, so the trade can no longer lose. Backtest showed this is neutral-to-slightly-positive on the trend-following entries (and matches the manual workflow); it only hurt earlier when entries were noisier. The cache is updated optimistically before the DB write; a failed write re-arms the cache.
    - To keep DB load flat under the high tick rate, the open-signal list is cached in memory (refreshed at most every 5s, and on each cron pass). A per-minute `@Cron` is only a **fallback** that re-checks open signals via the REST price if the WS feed stalls/disconnects.
    - **Observed close, not idealised fill**: `closedPrice` and `pnlUsd` use the **real price at the tick that crossed the level**, NOT the `takeProfit`/`stopLoss` value. So a fast move that overshoots the TP between ticks is recorded as-is (e.g. TP set 64370, closed 64571). This is intentional — Phase 1 must reflect real market behaviour, not flatter the numbers.
13. Web page `/day-trading` shows signals + stats (Total P&L in USD), auto-refreshing every 60s. Each signal shows volume and a PAPER/LIVE badge.
14. **Open-position live view**: while any ACTIVE signal exists, the page polls `GET /day-trading/price` every 5s (live BTCUSDT price from Bitget REST, 2s server-side cache). For each open position the card shows: a **Live price** banner with distance to TP/SL (%), and a header **unrealized P&L** chip (`~$X · ±N.NNR`) = `quantity × (live − entry)` signed by direction, plus the current R multiple. The polling stops automatically when there are no open positions.
15. **Entry rationale / methodology**: every card has a "Vì sao vào lệnh" disclosure that reconstructs the exact setup from `setupJson` — the method (Liquidity Sweep / Trend Pullback, and legacy Range Fade / Break & Retest), how it works, the concrete reason (levels swept, pullback swing, trendline H4/H1), and the SL/TP exit plan with R:R.
16. **Trader note**: every card (active and closed) has a "📝 Ghi chú" disclosure with the shared `MarkdownEditor` (TipTap). The note is saved via `PATCH /day-trading/signals/:id/note` and persisted on `DayTradingSignal.note` (markdown text). Empty/whitespace clears it. The editor bundle is lazy-loaded (`next/dynamic`, `ssr: false`).

## Edge Cases
- **WS disconnect**: auto-reconnects with backoff. A cron fallback (`:02/:17/:32/:47`) runs the scan only when `ws.isHealthy()` is false, so candle closes are not missed.
- **WS price stale**: result monitor falls back to REST `fetchCurrentPrice`.
- Bitget REST failure: logged as warning, scan skipped (non-fatal).
- Insufficient candle data (<30×15m, <20×1H, <10×4H): scan skipped.
- Daily limit reached (`maxTradesPerDay` signals or `maxLossesPerDay` losses): scan returns early.
- Settings are a singleton row, created with defaults (risk $2, minRR 2, 5 trades, 2 losses) on first access; editable from the `/day-trading` page (⚙ Cấu hình). The stop-distance floor (`minStopPct`, default 0.5%) lives in `SetupAnalyzerService`.
- Multiple setups trigger on one candle: only the first in quality order (Liquidity Sweep → Trend Pullback) is used.
- Overlapping triggers (WS + cron): re-entrancy guard + dedup prevent duplicate signals.
- **Close price ≠ TP/SL level (expected)**: detection is price-touch based on observed WS ticks, so `closedPrice` is the first tick at/through the level, which can overshoot the target on a fast move. The gap is real slippage from a *market-exit* model, not a bug. See the LIVE note below — a real TP **limit** order removes most of this gap.
- Real-time evaluation runs many times per second; the in-memory active-signal cache (5s TTL) keeps this off the DB hot path. A close write failure re-arms the cache so the next tick/cron retries.

## Phase 2 hand-off (placing real orders later)
- Add an authenticated Bitget trade service (account API keys).
- In `SignalExecutorService.execute()`, after persisting, place the order and store the broker order id (see the commented Phase 2 block). Set `mode = LIVE`.
- Optionally gate with an env flag (e.g. `LIVE_TRADING_ENABLED`).

> ⚠️ **LIVE mode MUST place a real TP limit order (and an SL stop) on Bitget — do not rely on the result monitor to "exit" the trade.**
>
> In Phase 1 (PAPER) the result monitor only *observes* price and records the first tick that crosses the level, which overshoots the TP on fast moves (the close price is the observed tick, not the TP). That is fine for review, but it is **not an execution mechanism**.
>
> When trading real money:
> 1. On entry, submit the **entry order** AND attach a **TP limit order at `takeProfit`** + a **stop-loss order at `stopLoss`** (Bitget supports TP/SL on the position, or place reduce-only orders). The exchange then fills the TP at ~`takeProfit` (± normal slippage), not at whatever the monitor happened to observe.
> 2. The result monitor's role in LIVE mode changes from *deciding the exit* to *reconciling* it: read the broker's actual fill price/PnL for the closed order and persist that, instead of the WS-tick price. Otherwise the stored `closedPrice`/`pnlUsd` will diverge from the real account.
> 3. Use the broker fill as the source of truth for `closedPrice`/`pnlUsd`; treat the WS-tick close as a PAPER-only approximation.

## Related Files (FE / BE / Worker)

- `apps/worker/src/modules/day-trading/bitget-websocket.service.ts` — **Phase 1 public WS**: real-time price + candle-close events
- `apps/worker/src/modules/day-trading/bitget.service.ts` — Bitget REST client (historical candles + price fallback)
- `apps/worker/src/modules/day-trading/setup-analyzer.service.ts` — setup detection (Liquidity Sweep, Trend Pullback), trendline trend (no EMA), swing-based SL, strong S/R-zone TP, stop-distance floor
- `apps/worker/src/scripts/backtest-day-trading.ts` — walk-forward backtest harness for the strategy (`pnpm --filter worker backtest:daytrading`); reuses the real `SetupAnalyzerService`, models fees + stop floor
- `apps/worker/src/modules/day-trading/signal-executor.service.ts` — **execution seam**: Phase 1 paper print/persist; Phase 2 live orders
- `apps/worker/src/modules/day-trading/result-monitor.service.ts` — TP/SL detection using WS price (REST fallback) + break-even stop move at +1R
- `apps/worker/src/scripts/backtest-day-trading.ts` — walk-forward backtest (`pnpm --filter worker backtest:daytrading`); parameterised TF, stop floor / ATR, RR, and `--managed` trade-management (partial + break-even)
- `apps/worker/src/modules/day-trading/day-trading.service.ts` — orchestrator: WS-triggered scan + cron fallback + dedup + guards
- `apps/worker/src/modules/day-trading/day-trading.module.ts` — NestJS module
- `apps/api/src/modules/day-trading/day-trading.controller.ts` — REST endpoints (`GET /day-trading/signals`, `/stats`, `/:id`, `GET /day-trading/price`, `PATCH /day-trading/signals/:id/note`, `GET|PUT /day-trading/settings`)
- `apps/api/src/modules/day-trading/day-trading.service.ts` — API service layer (incl. `getCurrentPrice()` — live Bitget price with 2s cache + stale fallback; `updateNote()`)
- `apps/api/src/modules/day-trading/dto/update-note.dto.ts` — trader-note update validation
- `apps/api/src/modules/day-trading/dto/update-settings.dto.ts` — settings update validation
- `packages/db/src/repositories/day-trading.repository.ts` — DB repository (incl. `findLatestSignal` dedup, `getSettings`/`updateSettings`, `countTodayLosses`, `updateNote`)
- `packages/db/prisma/schema.prisma` — `DayTradingSignal` (incl. `note`, `breakEvenMoved`) + `DayTradingSettings` models
- `packages/db/prisma/migrations/20260614120000_add_day_trading_break_even/migration.sql` — `breakEvenMoved` column
- `packages/db/prisma/migrations/20260614000001_add_day_trading_note/migration.sql` — `note` column
- `packages/db/prisma/migrations/20260613000004_add_day_trading_signals/migration.sql` — table
- `packages/db/prisma/migrations/20260613000005_add_day_trading_mode/migration.sql` — `mode` column
- `apps/web/src/widgets/day-trading/day-trading-feed.tsx` — signal feed + stats + PAPER/LIVE badge; live-price polling, unrealized P&L for open positions, the `describeSetup()` entry-rationale disclosure (incl. a fixed "Quản lý lệnh" line stating the +1R → break-even rule), a "🛡 SL hoà vốn" badge + "đã về hoà vốn (BE)" stop-loss sub-label when `breakEvenMoved`, and the `NoteBlock` markdown trader note
- `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx` — shared TipTap editor reused for the trader note
- `apps/web/src/app/globals.css` — `.dt-live*` (live banner), `.dt-why*` (rationale) and `.dt-note*` (trader note) styles
- `apps/web/src/_pages/day-trading-page/day-trading-page.tsx` — server page (SSR data load)
- `apps/web/src/app/day-trading/page.tsx` — App Router entry
- `apps/web/src/shared/api/types.ts` — `DayTradingSignal` (incl. `mode`, `note`), `DayTradingStats`, `DayTradingPrice`
- `apps/web/src/shared/api/client.ts` — `fetchDayTradingSignals`, `fetchDayTradingStats`, `fetchDayTradingSignalById`, `fetchDayTradingPrice`, `updateDayTradingSignalNote`
