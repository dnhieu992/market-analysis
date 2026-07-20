# EMA pullback (H1, long-only, TP@swing-high) — BTCUSDT

**Date:** 2026-07-19
**Goal:** Test "Setup #2 — EMA pullback in trend" for the user's profile
(**no fixed stop-loss → prioritise high win-rate over R:R**) on BTC **H1**.

## Strategy (new script)
`scripts/run-ema-pullback-tp-backtest.ts` — long-only mean-reversion, distinct from
the existing `run-ema-pullback-backtest.ts` (which trails an ATR stop).

- **Trend filter:** only hunt entries while `close > EMA200` (H1).
- **Entry:** candle whose `low <= EMA(pull)` but `close > EMA(pull)` (pullback that held) → enter at close.
- **TP:** nearest prior swing high = highest high over last `lookback` (20) candles → exit at that price when a later high reaches it.
- **`exitOnBreak` flag:**
  - `1` = exit at close if `close < EMA200` (thesis-break exit ≈ a soft SL).
  - `0` = **pure no-SL**: hold until TP (or end of data).
- $1000 compounded, no leverage, **fee 0.05%/side**.

## Commands
```bash
# with thesis-break exit
scripts/run-ema-pullback-tp-backtest.ts BTCUSDT 1h 365 1000 0.05 "20,50" 20 200 1
# pure no-SL (hold til TP) — matches the user's real behaviour
scripts/run-ema-pullback-tp-backtest.ts BTCUSDT 1h 365 1000 0.05 "20,50" 20 200 0
```

## Results — BTCUSDT H1, 8760 candles, 2025-07-19 → 2026-07-19
Buy & hold over the window: **−45.20%** (brutal bear/down year).

**exitOnBreak = yes (soft SL):**
| pullEMA | trades | winRate | avgWin | avgLoss |  PF  | breaks | return% | maxDD |
|---------|--------|---------|--------|---------|------|--------|---------|-------|
| EMA20   | 166    | 50.00%  | +0.85% | −1.30%  | 0.65 | 82     | −32.31  | 35.63 |
| EMA50   | 103    | 46.60%  | +1.10% | −1.28%  | 0.74 | 53     | −17.53  | 21.94 |

**exitOnBreak = NO (pure no-SL, hold til TP):**
| pullEMA | trades | winRate | avgWin | avgLoss |  PF  | return% | maxDD | expo |
|---------|--------|---------|--------|---------|------|---------|-------|------|
| EMA20   | 7      | 85.71%  | +1.22% | −48.32% | 0.15 | −44.43  | 48.32 | 98.9%|
| EMA50   | 10     | 90.00%  | +1.02% | −47.92% | 0.19 | −42.93  | 47.92 | 90.5%|

## Takeaway
The high-win-rate thesis is **confirmed but hollow on this data**. The pure no-SL
version hits **90% win-rate** — exactly the profile the user wants — yet still loses
**−43%**, because a **single** trade opened on 2025-10-07 @ $124k never revisited its
swing high (BTC crashed to $64k) and finished −48%, erasing dozens of +0.6–1.9% wins.
Exposure 90–98% = most of the year was spent bag-holding that one stuck long.

The soft-SL version raises the trade count but cuts win-rate to ~47–50% (H1 EMA200
whipsaws in a downtrend: half the trades exit on trend-break), and still loses.

**Conclusion:** the deciding variable is **market regime, not the H1 entry**. A long-only
no-SL strategy cannot print in a −45% year. High win-rate + no SL = concentrated **tail
risk**: the rare stuck bag wipes the book. To make this usable:
1. Gate by a **higher-timeframe** trend (daily/weekly up), not H1 EMA200 which whipsaws.
2. **DCA** the pullback with sizing that survives a deep drawdown (the `/tracking-coins`
   coin-selection + weekly-trend filter is precisely this regime gate).
3. Accept it sits flat in confirmed downtrends. Retest in an uptrend window before trusting.
