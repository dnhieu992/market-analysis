## Description
A `/strategy-test` back-test strategy: **"EMA-stack oversold StochRSI bounce"** — a LONG-only,
counter-trend mean-reversion play. It buys a coin that is trading below a bearish EMA34/89/200
stack and is stretched 7–15% below EMA34, at the moment StochRSI's %K (yellow) crosses up through
its MA %D while oversold. Take-profit ~10%, **no stop-loss** (position held until TP or end of data).

⚠ Backtest (`claude-backtest/runs/2026-07-13-ema-stack-oversold-stochrsi-bounce.md`) shows the
no-SL version has ~80% TP-hit but **negative expectancy** (−2.6%/trade) due to rare falling-knife
positions held indefinitely. Adding an ~8% SL flips it positive. Kept as specified by the user with
a warning in the strategy description.

## Main Flow
1. User opens `/strategy-test`, selects strategy **ema-stack-oversold-stochrsi**, a symbol, date
   range, timeframe (4h or 1d), and params (TP %, min/max distance below EMA34, oversold level).
2. Web posts to `POST /back-test/run`; the engine fetches Binance klines and calls the strategy per candle.
3. On each CLOSED candle the strategy checks: `close < EMA34 < EMA89 < EMA200`; distance
   `(EMA34-close)/EMA34 ∈ [distMin, distMax]`; StochRSI(14/14/3/3) bullish cross (`%K` crosses above
   `%D`) with `%K < osLevel`. If all true → LONG at close, `stopLoss = 0`, `takeProfit = close×(1+tpPct)`.
4. Engine exits when a later candle's high reaches TP; otherwise marks the open position to market at
   the last candle. `disableBreakeven = true` so the engine never moves the SL to entry.
5. Result summary (trades, win rate, PnL, maxDD, per-trade list) is persisted and rendered.

## Edge Cases
- **No stop-loss:** `stopLoss = 0` is never hit intra-candle for a long (`low > 0`), so a losing
  position is only closed by the end-of-data mark-to-market → can show a very large single loss and
  high maxDrawdown (verified: DOT 2025-11-21 exited −65%). This is intended per the user's rule.
- **Warm-up:** needs ≥ ~240 candles (EMA200 + StochRSI smoothing) before any signal fires; shorter
  ranges yield 0 trades.
- **One position at a time:** new entries are ignored while a position is open (engine invariant).
- **Fees:** the page engine reports gross (no fee model), unlike the standalone script (0.05%/side).

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/back-test/strategies/ema-stack-oversold-stochrsi.strategy.ts` — the strategy (EMA stack + StochRSI cross entry, TP-only, no SL). Auto-registered by `StrategyRegistryService`.
- `apps/web/src/widgets/back-test-feed/back-test-feed.tsx` — param state, params payload, and the settings UI block (TP %, dist min/max, oversold level).
- `scripts/run-ema-stack-oversold-stochrsi-backtest.ts` — standalone research script (basket sweep, SL/maxHold variants, MAE reporting).
- `claude-backtest/runs/2026-07-13-ema-stack-oversold-stochrsi-bounce.md` — backtest run log & takeaway.
