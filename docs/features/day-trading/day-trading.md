## Description
Automated 24/7 day trading signal scanner for BTCUSDT futures (Bitget). Detects two price action setups on the 15m chart with 1H/4H confirmation, persists signals for strategy review, and auto-updates results when TP or SL is hit.

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
5. `SetupAnalyzerService` runs two detectors:
   - **Liquidity Sweep**: 1H swing high/low swept ≥0.3%, closed back with engulfing/pin bar + volume spike.
   - **Break & Retest**: 4H/1H trend-confirmed level break (volume > avg×1.2), retest pullback, confirmation close.
6. **Dedup**: if the same setup+direction already fired within one candle window (~14 min), it is skipped.
7. **Risk/volume model** (configurable via settings): each trade risks exactly `riskPerTrade` USDT if SL is hit. TP is placed at `minRR` R (`minRR × |entry − stopLoss|`). Volume (BTC) = `riskPerTrade / |entry − stopLoss|`, `positionValue = quantity × entry`. P&L realized in USD = `quantity × price move`.
8. `SignalExecutorService.execute()` — **Phase 1**: logs `🔔 TÍN HIỆU [PAPER] …` and persists the signal with `mode = PAPER`, `status = ACTIVE`. No order is placed.
9. **Result monitor** (`@Cron` every minute) reads the **real-time WS price** (REST fallback if WS is stale) and marks ACTIVE signals `TP_HIT` / `SL_HIT`, recording `pnlUsd`.
10. Web page `/day-trading` shows signals + stats (Total P&L in USD), auto-refreshing every 60s. Each signal shows volume and a PAPER/LIVE badge.

## Edge Cases
- **WS disconnect**: auto-reconnects with backoff. A cron fallback (`:02/:17/:32/:47`) runs the scan only when `ws.isHealthy()` is false, so candle closes are not missed.
- **WS price stale**: result monitor falls back to REST `fetchCurrentPrice`.
- Bitget REST failure: logged as warning, scan skipped (non-fatal).
- Insufficient candle data (<30×15m, <20×1H, <10×4H): scan skipped.
- Daily limit reached (`maxTradesPerDay` signals or `maxLossesPerDay` losses): scan returns early.
- Settings are a singleton row, created with defaults (risk $2, minRR 2, 5 trades, 2 losses) on first access; editable from the `/day-trading` page (⚙ Cấu hình).
- Both setups trigger on one candle: only the first (Liquidity Sweep) is used.
- Overlapping triggers (WS + cron): re-entrancy guard + dedup prevent duplicate signals.
- Result check has no slippage modeling — price vs TP/SL, an approximation for review.

## Phase 2 hand-off (placing real orders later)
- Add an authenticated Bitget trade service (account API keys).
- In `SignalExecutorService.execute()`, after persisting, place the order and store the broker order id (see the commented Phase 2 block). Set `mode = LIVE`.
- Optionally gate with an env flag (e.g. `LIVE_TRADING_ENABLED`).

## Related Files (FE / BE / Worker)

- `apps/worker/src/modules/day-trading/bitget-websocket.service.ts` — **Phase 1 public WS**: real-time price + candle-close events
- `apps/worker/src/modules/day-trading/bitget.service.ts` — Bitget REST client (historical candles + price fallback)
- `apps/worker/src/modules/day-trading/setup-analyzer.service.ts` — setup detection (Break & Retest, Liquidity Sweep)
- `apps/worker/src/modules/day-trading/signal-executor.service.ts` — **execution seam**: Phase 1 paper print/persist; Phase 2 live orders
- `apps/worker/src/modules/day-trading/result-monitor.service.ts` — TP/SL detection using WS price (REST fallback)
- `apps/worker/src/modules/day-trading/day-trading.service.ts` — orchestrator: WS-triggered scan + cron fallback + dedup + guards
- `apps/worker/src/modules/day-trading/day-trading.module.ts` — NestJS module
- `apps/api/src/modules/day-trading/day-trading.controller.ts` — REST endpoints (`GET /day-trading/signals`, `/stats`, `/:id`, `GET|PUT /day-trading/settings`)
- `apps/api/src/modules/day-trading/day-trading.service.ts` — API service layer
- `apps/api/src/modules/day-trading/dto/update-settings.dto.ts` — settings update validation
- `packages/db/src/repositories/day-trading.repository.ts` — DB repository (incl. `findLatestSignal` dedup, `getSettings`/`updateSettings`, `countTodayLosses`)
- `packages/db/prisma/schema.prisma` — `DayTradingSignal` + `DayTradingSettings` models
- `packages/db/prisma/migrations/20260613000004_add_day_trading_signals/migration.sql` — table
- `packages/db/prisma/migrations/20260613000005_add_day_trading_mode/migration.sql` — `mode` column
- `apps/web/src/widgets/day-trading/day-trading-feed.tsx` — signal feed + stats + PAPER/LIVE badge
- `apps/web/src/_pages/day-trading-page/day-trading-page.tsx` — server page (SSR data load)
- `apps/web/src/app/day-trading/page.tsx` — App Router entry
- `apps/web/src/shared/api/types.ts` — `DayTradingSignal` (incl. `mode`), `DayTradingStats`
- `apps/web/src/shared/api/client.ts` — `fetchDayTradingSignals`, `fetchDayTradingStats`, `fetchDayTradingSignalById`
