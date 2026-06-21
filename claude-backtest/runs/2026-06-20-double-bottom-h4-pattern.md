# Double Bottom (mô hình 2 đáy) — H4, LONG only

**Date:** 2026-06-20
**Script:** `scripts/run-double-bottom-backtest.ts`
**Window:** 365 days · `4h` · $1000 compounded · fee 0.05%/side
**Context:** user asked to switch from indicator strategies to **price patterns** — first up, the
double-bottom on H4. This is a pure chart-pattern backtest (no UTBot), to see if it has an edge.

## Pattern logic
Confirmed fractal pivots (lookback `L` each side). A double bottom = two pivot lows L1, L2 with a
pivot high P (neckline) between them, where the bottoms are ~equal (`|L2−L1|/L1 ≤ tol`), separated by
`[minGap,maxGap]` bars, and `height=(P−bottom)/bottom ≥ minHeight`.
- **Entry:** first candle that CLOSES above the neckline within `entryWindow` bars after L2 confirms.
- **SL:** `bottom × (1 − 0.2%)` (just below the lower bottom).
- **TP:** measured move = `neckline + tpMult × (neckline − bottom)`.
- Exit on first SL/TP touch intra-candle (SL-first if both in one candle). One position at a time.

## Commands
```bash
# default (TP = 1× height)
scripts/run-double-bottom-backtest.ts 365 0.05 1000
# sweeps: [days fee cap L tol minHeight tpMult entryWindow maxGap]
scripts/run-double-bottom-backtest.ts 365 0.05 1000 3 3 2 1.5 24 80
scripts/run-double-bottom-backtest.ts 365 0.05 1000 3 3 2 2.0 24 80
scripts/run-double-bottom-backtest.ts 365 0.05 1000 3 2 3 1.5 24 80
```

## Results

**TP = 1× height (default, L=3, tol=3%, minHeight=2%):**

| symbol | trades | WR | return% | maxDD% | avgR |
|--------|------:|----:|--------:|-------:|-----:|
| BTCUSDT | 23 | 30.4% | −46.1% | 46.8 | −0.48 |
| ETHUSDT | 19 | 42.1% | −43.6% | 47.9 | −0.31 |
| BNBUSDT | 23 | 69.6% | **+11.7%** | 34.3 | +0.13 |
| SOLUSDT | 24 | 62.5% | −12.2% | 33.5 | −0.02 |
| **TOTAL** | 89 | 51.7% | — | — | **−0.16** |

**TP variants (total expectancy in R):**

| config | total trades | WR | avgR |
|--------|------:|----:|-----:|
| TP 1.0× height | 89 | 51.7% | −0.16 |
| TP 1.5× height | 73 | 39.7% | −0.18 |
| TP 2.0× height | 62 | 32.3% | −0.21 |
| tol2%/minH3%, TP1.5× | 67 | 40.3% | −0.15 |

## Takeaway

**The naive double-bottom breakout has no edge on H4 over the last year — negative expectancy in
every config tested (avgR −0.15 to −0.21).** Root cause is geometry: entering on the neckline
breakout puts entry ~1 pattern-height above the bottom, so the stop (at the bottom) risks ≈1× height
while the measured-move target only pays ≈1× height → an RR barely 1:1 *before* fees and before the
breakout-close overshoot eats the reward. Raising TP to let winners run **collapses the win rate
faster than it grows the winners** (1.0×→2.0× drops WR 52%→32%, expectancy −0.16→−0.21). Tighter
pattern filters (tol 2%, minHeight 3%) don't rescue it.

**Only BNB is consistently positive** (WR 70%, +11.7%) — the same pair that carries the live UTBot
book; the other three bleed, with BTC the worst (WR 30%, avgR −0.48). The breakouts mostly fail
(false breaks / immediate retrace to stop) in the choppy-to-bearish tape of this window.

**Verdict: do NOT trade the bare double-bottom breakout.** If pursued further, the levers worth
testing are (a) a **retest entry** instead of breakout-close (enter on the pullback to the neckline,
much tighter stop → better RR), (b) a **trend/regime filter** (only take longs above a higher-TF EMA
or while UTBot trend is bull), and (c) **volume confirmation** on the breakout. As-is it's a losing
pattern on these 4 H4 symbols.
