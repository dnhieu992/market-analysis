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
   - **One open position per side**: a new entry is blocked only when a live (ACTIVE) signal of the **same direction** already exists. An opposite-direction setup is allowed — e.g. a SHORT can still be running while a fresh LONG setup opens. Only **same-side** stacking is forbidden (the pattern that multiplied drawdown when correlated same-side entries all stopped out on one adverse candle). If both LONG and SHORT are already open, the scan short-circuits before fetching candles.
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
17. **Force-close at market** (manual override): each OPEN card shows an "✕ Đóng lệnh (market)" button. It calls `POST /day-trading/signals/:id/close`, which prices the exit at the current Bitget price and writes the signal as `MANUAL_CLOSE` with the realized P&L. The write goes through `repo.closeActiveSignal` (an atomic `updateMany WHERE status='ACTIVE'`), so it is **race-safe across processes** — if the worker's result monitor closes the same signal via TP/SL at the same moment, exactly one side wins and the other is a no-op (the API returns `409 Conflict`, the monitor logs "already closed"). `MANUAL_CLOSE` P&L is included in **Total P&L** but excluded from **win rate** (it isn't a strategy verdict).

### Reliability (live-readiness, Phase 1 foundations)
- **Retry with backoff** (`retry.util.ts` → `withRetry`): wraps the critical I/O — Bitget candle/price fetch and the result-monitor close write — retrying up to 3× with exponential backoff (500ms→1s→2s) so a transient network/DB hiccup doesn't drop a scan or leave a phantom-open position. Only repeat-safe operations are wrapped.
- **Audit trail** (`DayTradingActionLog` table, `audit.util.ts`): append-only log of important actions — `SETUP_DETECTED`, `SETUP_SKIPPED` (with reason: same-side-open / dedup), `ORDER_PLACED`, `BE_MOVED`, `CLOSED`, `MANUAL_CLOSE` — with `signalId`, message and JSON detail. Survives pm2 log rotation so the *why* behind any trade is reconstructable. Writes are fire-and-forget and never break the trading flow.

## Edge Cases
- **WS disconnect**: auto-reconnects with backoff. A cron fallback (`:02/:17/:32/:47`) runs the scan only when `ws.isHealthy()` is false, so candle closes are not missed.
- **WS price stale**: result monitor falls back to REST `fetchCurrentPrice`.
- Bitget REST failure: logged as warning, scan skipped (non-fatal).
- Insufficient candle data (<30×15m, <20×1H, <10×4H): scan skipped.
- **EMA50 price-location gate is fail-CLOSED**: the Trend Pullback entry requires price on the trend side of the 15m EMA50. If the EMA can't be computed (too few candles → `ema50Entry = 0`), the gate now **blocks** the entry instead of waving it through. Earlier it failed *open* (`ema50Entry === 0 || …`), which silently disabled the filter — two LIVE shorts with `ema50: 0` in their `setupJson` slipped through and stopped out even though the committed logic (EMA active) rejected both. Fail-closed means a missing EMA can never again disable a core filter.
- Daily limit reached (`maxTradesPerDay` signals or `maxLossesPerDay` losses): scan returns early.
- Settings are a singleton row, created with defaults (risk $2, minRR 2, 5 trades, 2 losses) on first access; editable from the `/day-trading` page (⚙ Cấu hình). The stop-distance floor (`minStopPct`, default 0.5%) lives in `SetupAnalyzerService`.
- Multiple setups trigger on one candle: only the first in quality order (Liquidity Sweep → Trend Pullback) is used.
- Overlapping triggers (WS + cron): re-entrancy guard + dedup prevent duplicate signals.
- **Close price ≠ TP/SL level (expected)**: detection is price-touch based on observed WS ticks, so `closedPrice` is the first tick at/through the level, which can overshoot the target on a fast move. The gap is real slippage from a *market-exit* model, not a bug. See the LIVE note below — a real TP **limit** order removes most of this gap.
- Real-time evaluation runs many times per second; the in-memory active-signal cache (5s TTL) keeps this off the DB hot path. A close write failure re-arms the cache so the next tick/cron retries.
- **Manual close vs auto TP/SL race**: a "Đóng lệnh (market)" click and a TP/SL tick can land at the same instant from two different processes. `closeActiveSignal` (`updateMany WHERE status='ACTIVE'`) makes the close atomic, so exactly one wins; the loser returns `false` (worker logs "already closed", API returns `409 Conflict`). No double-close, no overwritten exit.
- **Force-close with no live price**: if Bitget price can't be fetched, the close endpoint returns `503` rather than closing at a bad/zero price.

## Phase 2 — LIVE order placement

The execution seam now has a real LIVE path. `SignalExecutorService.execute()` branches on `LIVE_TRADING_ENABLED` (+ credentials present):
- **PAPER** (default): print + persist `mode='PAPER'`, no order.
- **LIVE**: persist `mode='LIVE'` (the signal id is the broker `clientOid` → idempotency) → `setLeverage()` → `placeOrder()` with **required preset TP/SL** attached → store `brokerOrderId`. On failure the signal is set `status='FAILED'` (no phantom ACTIVE) and an `ORDER_FAILED` audit row captures the Bitget code + message.

`BitgetTradeService` (`bitget-trade.service.ts`) is the authenticated Bitget v2 mix REST client (HMAC-signed): `setLeverage`, `placeOrder` (market + preset TP/SL, **TP and SL are mandatory** — a naked position is refused before hitting the exchange), `closePosition` (flash-close), `getPosition`/`getOrder` (read-only, `withRetry`-wrapped). Credentials are read lazily so the worker still boots in PAPER without keys (`isConfigured()` gates the LIVE path). Leverage defaults to `BITGET_LEVERAGE=10` (isolated); position **size is risk-based, independent of leverage**.

Env: `BITGET_API_KEY` / `BITGET_API_SECRET` / `BITGET_API_PASSPHRASE` (account key, Trade-only, IP-whitelisted), `BITGET_PRODUCT_TYPE` (`usdt-futures` real | `susdt-futures` demo), `BITGET_LEVERAGE`, `LIVE_TRADING_ENABLED`, `BITGET_POSITION_MODE` (`hedge` default | `one-way`).

**Position mode**: Bitget hedge-mode accounts require `tradeSide` on `place-order`; one-way accounts must omit it. `placeOrder` adds `tradeSide:'open'` when `BITGET_POSITION_MODE` is `hedge` (the default — must match the Bitget account's actual mode, or every order is rejected with HTTP 400). The signed `request()` parses the Bitget `{code,msg}` envelope **even on HTTP 4xx** (`validateStatus: () => true`) so a business rejection surfaces its real Bitget code instead of a bare "status code 400". Order size is floored to the contract `volumePlace` (BTCUSDT = **4** dp, `minTradeNum` 0.0001) and a zero-after-floor size is refused before sending.

> 💵 **Small-account sizing**: with ~$50 capital, lower `riskPerTrade` to ~$0.5 in ⚙ Cấu hình. The default $2 risk at a 0.5% stop = $400 notional (~$40 margin at 10x), and the bot may hold LONG+SHORT at once → would exceed the account.

### LIVE result-monitor + reconciliation (implemented)

LIVE signals do **not** exit on a WS tick. The exchange owns their preset TP/SL; the bot reconciles the DB against the real broker state:
- The WS-tick `evaluate()` path skips `mode==='LIVE'` (and skips bot-side break-even for LIVE — it would only diverge the DB stop from the exchange's actual SL order).
- `ResultMonitorService.reconcileLiveSignals()` runs **at startup** (5s after boot) and **every minute** (`DayTradingService.runResultMonitor`). For each ACTIVE LIVE signal: `getPosition(symbol, holdSide)` — if still open, leave it; if the exchange is flat, `getClosedPosition()` reads the real fill (`closeAvgPrice` + `netProfit` after fees), the DB row is closed race-safely (`closeActiveSignal`), classified TP_HIT/SL_HIT by which level the fill is nearer, and an `RECONCILE_FIX` audit row records the broker-sourced exit. A lagging history feed returns null → the row is left ACTIVE for the next pass. This is the restart-safety sync (state is lost on every `./deploy.sh`).

### 🟡 Before sizing up (recommended, not strictly blocking)
1. **Retry-wrap the order place/close calls** (now safe given `clientOid` idempotency) so a transient network hiccup on entry doesn't drop a setup.
2. **Kill switch** (`tradingEnabled` flag in the UI, checked before execute, no deploy) and **Telegram alerts** for order-place failures / reconciliation fixes / stalled WS.
3. **Verify before first real order**: `PRICE_DECIMALS`/`SIZE_DECIMALS` vs the BTCUSDT contract, account margin mode = isolated (or send `crossed`), and lower `riskPerTrade` to ~$0.5 for a ~$50 account.

**Manual force-close (LIVE) — wired.** `POST /day-trading/signals/:id/close` now flash-closes the REAL Bitget position before writing the DB row. Order of operations is deliberate: check position → `closePosition` on the exchange → then `closeActiveSignal` MANUAL_CLOSE. If the exchange close fails the request throws (`503`) and the row stays ACTIVE (never orphan an open position). If the exchange is already flat (TP/SL filled meanwhile) it returns `409` so the worker reconciliation records the real fill instead of a MANUAL_CLOSE estimate. Uses a small scoped `BitgetTradeClient` in the API (the API can't import the worker's service); keep its HMAC signing in sync with the worker client. MANUAL_CLOSE PnL is still the price-estimate (excluded from win rate).

> ✅ **Done**: idempotent `clientOid` (= signal id), `brokerOrderId` column + persistence, mandatory preset TP/SL, deterministic leverage, immediate error logging + durable `ORDER_FAILED` audit, LIVE reconciliation (startup + per-minute) reading real broker fills, WS-tick path PAPER-only.

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
- `apps/worker/src/modules/day-trading/signal-executor.service.ts` — **execution seam**: PAPER print/persist; LIVE setLeverage→placeOrder(preset TP/SL)→attach `brokerOrderId`, `ORDER_FAILED` audit on failure
- `apps/worker/src/modules/day-trading/bitget-trade.service.ts` — authenticated Bitget v2 mix client (HMAC): `setLeverage`, `placeOrder` (market + mandatory preset TP/SL), `closePosition`, `getPosition(symbol, holdSide?)`, `getOrder`, `getClosedPosition` (real fill + netProfit for reconciliation); `BitgetApiError` carries the exchange code
- `apps/worker/src/modules/day-trading/result-monitor.service.ts` (LIVE) — `reconcileLiveSignals()`/`reconcileOne()`: startup + per-minute broker reconciliation closing LIVE rows from the real fill; WS-tick path skips LIVE
- `packages/db/prisma/migrations/20260620000000_add_day_trading_broker_order_id/migration.sql` — `brokerOrderId` column
- `packages/db/prisma/migrations/20260620000001_clear_day_trading_signals/migration.sql` — one-time wipe of existing signals before going LIVE
- `apps/worker/src/modules/day-trading/result-monitor.service.ts` — TP/SL detection using WS price (REST fallback) + break-even stop move at +1R; race-safe close via `closeActiveSignal`, retry-wrapped close write, audit logging
- `apps/worker/src/modules/day-trading/retry.util.ts` — `withRetry()` (3× exponential backoff) for critical I/O; **wrap order place/close only after idempotency is added**
- `apps/worker/src/modules/day-trading/audit.util.ts` — fire-and-forget `audit()` helper writing `DayTradingActionLog` rows (never throws)
- `apps/worker/src/scripts/backtest-day-trading.ts` — walk-forward backtest (`pnpm --filter worker backtest:daytrading`); parameterised TF, stop floor / ATR, RR, and `--managed` trade-management (partial + break-even)
- `apps/worker/src/modules/day-trading/day-trading.service.ts` — orchestrator: WS-triggered scan + cron fallback + dedup + guards
- `apps/worker/src/modules/day-trading/day-trading.module.ts` — NestJS module
- `apps/api/src/modules/day-trading/day-trading.controller.ts` — REST endpoints (`GET /day-trading/signals`, `/stats`, `/:id`, `GET /day-trading/price`, `PATCH /day-trading/signals/:id/note`, `POST /day-trading/signals/:id/close`, `GET|PUT /day-trading/settings`)
- `apps/api/src/modules/day-trading/day-trading.service.ts` — API service layer (incl. `getCurrentPrice()` — live Bitget price with 2s cache + stale fallback; `updateNote()`; `closeSignal()` — race-safe manual market close, **flash-closes the real Bitget position first for LIVE**)
- `apps/api/src/modules/day-trading/bitget-trade.client.ts` — scoped authenticated Bitget client for the API force-close (`getPositionSize`, `closePosition`); HMAC signing mirrors the worker's `BitgetTradeService`
- `apps/api/src/modules/day-trading/dto/update-note.dto.ts` — trader-note update validation
- `apps/api/src/modules/day-trading/dto/update-settings.dto.ts` — settings update validation
- `packages/db/src/repositories/day-trading.repository.ts` — DB repository (incl. `findLatestSignal` dedup, `getSettings`/`updateSettings`, `countTodayLosses`, `updateNote`, race-safe `closeActiveSignal`, `logAction`)
- `packages/db/prisma/schema.prisma` — `DayTradingSignal` (incl. `note`, `breakEvenMoved`) + `DayTradingSettings` + `DayTradingActionLog` models
- `packages/db/prisma/migrations/20260619120000_add_day_trading_action_log/migration.sql` — `day_trading_action_logs` audit table
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
- `apps/web/src/shared/api/client.ts` — `fetchDayTradingSignals`, `fetchDayTradingStats`, `fetchDayTradingSignalById`, `fetchDayTradingPrice`, `updateDayTradingSignalNote`, `closeDayTradingSignal`
- `apps/web/src/widgets/day-trading/day-trading-feed.tsx` (`CloseButton`) — force-close button on open cards (confirm → `POST …/close` → refresh)
- `apps/worker/test/day-trading-retry.util.spec.ts`, `day-trading-scan.spec.ts`, `day-trading-result-monitor.spec.ts` — unit tests (retry, one-per-side rule, TP/SL/BE/race-safe close); the worker suite is a `deploy.sh` gate
