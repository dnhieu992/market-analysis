## Description
Two improved back-test strategy variants of the original `supertrend-engulfing`, added to the
back-test engine (`/strategy-test`). They explore raising the strategy's per-trade edge while
keeping the same engulfing + Supertrend core. Both are auto-registered by `StrategyRegistryService`
(file-based discovery) and selectable from the Strategy Test page like any other strategy.

- **`supertrend-engulfing-mtf`** — the original logic plus:
  1. ATR-based SL/TP (scales with volatility / price level) instead of fixed `$500/$600` absolute stops.
  2. A 4H Supertrend trend filter (only long when 4H is bullish, only short when 4H is bearish).
- **`supertrend-engulfing-regime`** — the `-mtf` base plus an optional regime gate:
  - ADX trend-strength filter (`minAdx`, default 20) to skip chop.
  - RSI extreme guard (don't long into overbought / short into oversold).

Back-test finding (BTCUSDT, 2025-01 → 2026-06, no fees): `-mtf` with `rr=1.6` gives the highest total
PnL (~3.1× the original); `-regime` with `minAdx=25, rr=1.6` gives the highest per-trade edge. Lowering
`rr` raises win rate (≈70% at `rr=0.4`) but collapses profit — win rate is governed by R:R, not entry filters.

## Main Flow
1. User opens `/strategy-test`, picks a variant, symbol (`BTCUSDT`), date range, and optional `params`.
2. `POST /back-test/run` → `BackTestService` resolves the strategy via `StrategyRegistryService`,
   fetches entry-TF candles (forced `M30`) plus HTF candles (`4h`), and calls `BackTestEngineService.run`.
3. Per bar, the engine calls `strategy.evaluate(ctx)`; the variant returns a `TradeSignal`
   (`direction`, `entryPrice`, ATR-based `stopLoss`/`takeProfit`) when its filters pass.
4. The engine simulates SL/TP/breakeven exits and returns a `BackTestSummary`
   (win rate, total PnL, max drawdown, Sharpe).

## Edge Cases
- HTF (`4h`) candles are passed as the full range; both variants slice them to `openTime <= current.openTime`
  to avoid lookahead bias.
- Insufficient history (entry-TF or HTF) returns `null` (no trade) until enough candles exist.
- Time filter: no new entries from 15:00 UTC onward (kept from the original).
- All thresholds are overridable via `params` (`rr`, `slAtrMult`, `stPeriod`, `stMultiplier`,
  `atrPeriod`, and for `-regime`: `useAdx`, `minAdx`, `adxPeriod`, `useRsi`, `rsiPeriod`,
  `longRsiMax`, `shortRsiMin`); each falls back to a sane default.
- The back-test engine does NOT deduct trading fees — net-of-fee profitability must be judged separately.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/back-test/strategies/supertrend-engulfing-mtf.strategy.ts` — ATR SL/TP + 4H trend filter variant.
- `apps/api/src/modules/back-test/strategies/supertrend-engulfing-regime.strategy.ts` — `-mtf` base + ADX/RSI regime gate.
- `apps/api/src/modules/back-test/strategy-registry.service.ts` — auto-discovers both files (no manual registration).
- `apps/api/src/modules/back-test/back-test-engine.service.ts` — simulates trades from each strategy's signals.
- `apps/web/src/app/strategy-test/page.tsx` — Strategy Test page that lists and runs registered strategies.
