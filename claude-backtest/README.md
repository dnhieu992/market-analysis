# Claude Backtest

This folder is the single source of truth for **how Claude Code runs backtests in this repo**
and a **log of every backtest run**. When the user says "backtest", Claude must:

1. Read this README to recall the flow, the scripts, and the conventions.
2. Run the appropriate script (below) with real Binance data.
3. **Write a summary of the run** to `claude-backtest/runs/<YYYY-MM-DD>-<slug>.md`.

No API/auth is required — the scripts fetch public Binance klines directly.

---

## The strategy flow (user's preferred flow)

**UTBot trend stop-and-reverse on candle CLOSE — always in market.**

- Indicator: **UTBot** = Wilder ATR trailing stop. `nLoss = keyValue × ATR(atrPeriod)`.
  - `atrPeriod` default **10**.
  - `keyValue` = ATR multiplier (a.k.a. "key value"/sensitivity). Distance of the stop line from price.
    - **small** keyValue → stop hugs price → flips often → many trades → more fees/noise.
    - **large** keyValue → stop far from price → price must move more to flip → fewer trades.
- `trend = close > stop ? bull : bear`.
- **Entry/exit rule:** when an H4 candle **CLOSES** and the trend flips
  (bull→bear or bear→bull), **exit the current position at that candle's close AND
  immediately enter the opposite position at the same close** (stop-and-reverse).
- **No fixed TP.** The only exit is the confirmed close-based trend flip.
- Capital: compounded (e.g. $1000 start, fully reinvested, no leverage).

> ⚠️ This is **different** from the in-repo strategy `supertrend-engulfing-mtf`, which exits
> when price touches the trailing-stop line *intra-candle* (low/high), not on a confirmed
> close flip, and does not stop-and-reverse. Use the **flip** script for the user's flow.

### Fees
User's real fee = **0.05%/side** (0.05% open + 0.05% close = **0.1% per round-trip flip**).
Rule of thumb: **fee drag ≈ (trades/year) × 0.1% of equity**. High-frequency configs
(low keyValue on H4) are heavily penalised. Results **exclude slippage and funding** —
real outcomes are lower, especially on futures held continuously.

---

## How to run

Both scripts live in `scripts/`. Always prefix with `TS_NODE_TRANSPILE_ONLY=1`.

### 1. User's flow — stop-and-reverse on close (PREFERRED)
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts <symbol> <interval> <days> <capital> <feePctPerSide> <kvList>

# example: BTC H4, 1 year, $1000, 0.05%/side, sweep keyValue 1..4
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts BTCUSDT 4h 365 1000 0.05 "1,2,3,4"
```
Outputs per keyValue: trades, win rate, **final equity (net of fees)**, return %, max drawdown.
Pass `feePctPerSide=0` to see gross.

### 2. In-repo engine strategy (intra-candle trailing stop)
Runs the actual `BackTestEngineService` + a registered strategy class.
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-backtest.ts <strategy> <symbol> <interval> <days> <volume> [atrPeriod] [keyValue]

# example
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-backtest.ts supertrend-engulfing-mtf BTCUSDT 4h 365 1000 10 2
```
Strategies: `supertrend-engulfing-mtf`, `supertrend-engulfing`.

---

## Convention: log every run
After ANY backtest, create `claude-backtest/runs/<YYYY-MM-DD>-<slug>.md` containing:
- Command(s) run
- Config (symbol / interval / days / capital / fee / params)
- Results table (trades, win rate, net equity, return %, max DD)
- One-paragraph takeaway

See existing files in `runs/` for the format.
