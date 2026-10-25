## Description
The `/trading-analysis` page is the **strategy paper-trade board**: five rule-based strategies run
automatically, in parallel, on every coin in `PAPER_SYMBOLS` (BTC, ETH, SOL — SOL added 2026-10-15)
and log simulated trades so the live results can be compared with their backtests. Nothing is
sent to an exchange. Each strategy has one config row / card (enable, risk $, editable markdown
doc); its trades carry their own `symbol`, and at most one trade is open per (strategy, coin).

| id | strategy | TF | side |
|---|---|---|---|
| `pdhl-btc` | Breakout of the previous UTC day's high/low, SL on the opposite side, **skip if SL > 3.5% from entry**, TP 2R, EOD close | 1h | both |
| `rsi-5m-short-1r` | A · RSI14 crosses down 45, RSI14 1h ≤ 40, 1D ≤ 60, SL 1%, TP 1R | 5m | short |
| `rsi-5m-long-1r` | B · RSI7 crosses back up 30, RSI14 1h ≥ 40, 1D ≥ 50, SL 1.5%, TP 1R | 5m | long |
| `rsi-5m-long-div-1_5r` | C · bullish RSI7 divergence, volume < MA20, RSI14 1h ≥ 40, **trend + anti-chase filters**, SL 1.5%, TP 1.5R | 5m | long |
| `rsi-15m-long-2r` | D · RSI7 crosses up 50, volume < MA20, RSI14 1h ≥ 40, 1D ≥ 30, **trend + anti-chase filters**, SL 1.5%, TP 2R | 15m | long |

**Trend filter** (`trendFilter`): skip a LONG when the last closed 1h candle is in a downtrend
(close and EMA50 both below EMA200). **Anti-chase** (`maxRise24hPct: 1`): skip a LONG when the 1h
close is up ≥ 1% vs 24 closed 1h candles earlier. Both were added to C and D on 2026-10-15 after the
review of the first 89 paper trades; every other change proposed in that review was backtested and
rejected (see `claude-backtest/runs/2026-10-15-paper-strategies-review-btc-eth-sol.md`).

**2026-10-25 review** (`claude-backtest/runs/2026-10-25-paper-strategies-review-2.md`): PDH/PDL skips a
breakout whose stop is more than `PDHL_MAX_RISK_PCT` (3.5%) from the entry; A, B and C stop opening
trades on SOL (`symbols` on the strategy def — negative every backtest year). Open trades on a coin a
strategy no longer runs on are still managed until they close.

## Main Flow
1. **RSI/volume engine** (`RsiVolumePaperEngineService`, cron 15s after every 5 min): per coin, fetch
   5m/15m/1h(1000)/1d candles; per strategy, manage its open trade candle by candle with
   `stepPosition` (SL before TP), then — if flat and the last closed candle comes after the last
   exit — `firesAt` decides the signal and the trade opens at the next candle's open.
2. **PDH/PDL engine** (`StrategyPaperTradesService.runScanTick`, cron at minute 2): per coin, manage
   the open trade (SL / TP / EOD close), then `pdhlSignal` on the last closed 1h candle; one entry
   per side per UTC day.
3. On open and on close a setup chart on the trade's timeframe is rendered and stored in R2.
4. The board (`GET /strategy-paper-trades`) lists strategy cards (rules, BTC backtest, live
   stats), open trades with unrealized R, and history with per-trade feedback.

## Edge Cases
- **Stale data**: a signal candle older than one timeframe is skipped.
- **Overlapping ticks**: the unique key (strategyId, symbol, openedAt, direction) rejects a duplicate open.
- **Strategy docs are stored per config row**: the built-in default (`defaultDocFor` /
  `DEFAULT_STRATEGY_DOC`) only seeds a new row. After changing rules, reset the doc
  (`POST /strategy-paper-trades/doc/reset`) or update the row, otherwise the dialog shows the old text.
- **Breakeven / max-hold** (`breakeven`, `maxHoldHours`, exits `CLOSED_BE` / `CLOSED_TIME`) are
  supported by `stepPosition` and the backtest but **not enabled** on any live strategy — they
  lowered the backtested result.
- **ETH/SOL**: the RSI strategies were tuned on BTC; most are negative on ETH/SOL in the backtest.
  They run there to measure that, not because an edge is expected.

## Related Files (FE / BE / Worker / DB)
- `apps/web/src/_pages/trading-analysis-page/trading-analysis-page.tsx` — server page, renders `StrategyBoard`.
- `apps/web/src/widgets/strategy-board/strategy-board.tsx` — board UI, status labels.
- `apps/api/src/modules/strategy-paper-trades/paper-symbols.ts` — coins every strategy runs on.
- `apps/api/src/modules/strategy-paper-trades/rsi-volume-strategies.ts` — RSI strategy defs, `firesAt`, `stepPosition`, default docs.
- `apps/api/src/modules/strategy-paper-trades/pdhl-rules.ts` — PDH/PDL signal (shared with the backtest).
- `apps/api/src/modules/strategy-paper-trades/rsi-volume-paper-engine.service.ts` — 5-minute RSI engine.
- `apps/api/src/modules/strategy-paper-trades/strategy-paper-trades.service.ts` — PDH/PDL engine, board, docs, notes.
- `packages/db/src/repositories/strategy-paper-trade.repository.ts` — trades/config repo, `DEFAULT_STRATEGY_DOC`.
- `scripts/run-paper-strategies-backtest.ts` — backtest using the same signal/management code.
