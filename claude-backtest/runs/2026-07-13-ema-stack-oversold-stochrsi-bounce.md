# EMA34/89/200 extended-below + StochRSI oversold-cross bounce (LONG)

**Date:** 2026-07-13
**Script:** `scripts/run-ema-stack-oversold-stochrsi-backtest.ts`

## Strategy (user's rule)
Counter-trend "catch the falling knife" mean-reversion bounce, LONG only.

Entry when a CLOSED candle satisfies **all**:
1. Price below a bearish EMA stack: `close < EMA34 < EMA89 < EMA200`
2. Price stretched **7–15% below EMA34**: `0.07 ≤ (EMA34−close)/EMA34 ≤ 0.15`
3. **StochRSI (14/14/3/3) bullish cross in oversold**: `%K` (yellow) crosses above its MA `%D` from below, while `%K < 20`.

Take-profit **+10%**. User specified **no SL**. This run also sweeps SL / max-hold to measure the falling-knife risk.

Basket: `BTC ETH SOL BNB XRP ADA AVAX LINK DOGE DOT`. Fee **0.05%/side**. $1000 compounded per symbol.

## Commands
```bash
# base (TP-only, no SL) — 4h, 730d
scripts/run-ema-stack-oversold-stochrsi-backtest.ts "<basket>" 4h 730 1000 0.05 10 7 15 20 0 0
# A: 4h + SL 8%
... 4h 730 1000 0.05 10 7 15 20 8 0
# B: 4h + maxHold 60 bars
... 4h 730 1000 0.05 10 7 15 20 0 60
# C: 1d + SL 8%
... 1d 900 1000 0.05 10 7 15 20 8 0
# D: 4h + SL 8% + maxHold 60
... 4h 730 1000 0.05 10 7 15 20 8 60
```

## Results (POOLED, equal-weight per trade)

| Variant | Trades | TP-hit | WinRate | **Avg net/trade** | Median | Worst MAE |
|---|---|---|---|---|---|---|
| Base 4h — TP only, **no SL** | 44 | 79.5% | 79.5% | **−2.63%** | +9.9% | **−76.8%** |
| A · 4h + SL 8% | 104 | 54.8% | 54.8% | **+1.77%** | +9.9% | −13.5% |
| B · 4h + maxHold 60 (~10d) | 90 | 57.8% | 67.8% | **+2.41%** | +9.9% | −32.8% |
| C · 1d + SL 8% | 40 | 55.0% | 60.0% | **+2.51%** | +9.9% | −19.6% |
| D · 4h + SL 8% + maxHold 60 | 104 | 51.9% | 55.8% | **+1.82%** | +9.9% | −13.5% |

## Takeaway
The rule **exactly as specified (TP 10%, no stop) LOSES money** despite an ~80% win rate. It is a textbook
mean-reversion trap: dozens of tidy +10% TPs are erased by a few positions that keep falling and are held
indefinitely (DOGE −76%, avg MAE −20%, positions held thousands of bars). Average expectancy is **−2.6%/trade**.

Adding **any** risk control flips it positive:
- **8% hard SL (variant A/D)** gives the cleanest tail: worst MAE −13.5%, +1.8%/trade over 104 trades — the most robust.
- **maxHold timeout (B)** or **daily (C)** give slightly higher avg/trade but keep deeper drawdowns (−20 to −33%).

**Recommendation:** ship it with an **8% SL** (SL ≈ 0.8× the 10% TP), which is the version worth putting on
`/strategy-test`. The no-SL version should not be traded live. Still counter-trend and modest — not a strong edge,
but positive and bounded once risk is controlled.
