# BTC SHORT @ 00:00 UTC — 1D bear filter × exit-hour (rescue attempt)

**Date:** 2026-06-20
**Script:** `scripts/run-btc-short-0400-bearfilter-backtest.ts`
**Window:** 365 days · `1h` entries + `1d` filter · $1000 fixed/trade · fee 0.05%/side · TP −$500
**Context:** the bare BTC short (`…-tp500-exit0800.md`) was net −$239 (gross +$126, fees $365). This
tries the two levers that fixed the long-side alt strategy: **exit at 04:00** and a **1D BEAR filter**
(only short on prior-day downtrend). Filters: UTBot-1D (kv2/ATR10), EMA200-1D.

## Command
```bash
scripts/run-btc-short-0400-bearfilter-backtest.ts 365 0.05 1000 500 <exitHour>
```

## Results (TP −$500, $1000/trade)

| exit | filter | trades | TP% | gross | fees | NET | net/trade |
|-----:|--------|------:|----:|------:|-----:|----:|----------:|
| 04:00 | none | 365 | 39% | +$11.61 | −$365 | −$353.31 | −$0.97 |
| 04:00 | utbot | 224 | 43% | +$24.25 | −$224 | −$199.72 | −$0.89 |
| 04:00 | ema200 | 231 | 38% | −$40.78 | −$231 | −$271.69 | −$1.18 |
| **08:00** | none | 365 | 52% | **+$125.63** | −$365 | −$239.41 | −$0.66 |
| 08:00 | utbot | 224 | 53% | +$69.08 | −$224 | −$154.93 | −$0.69 |
| **08:00** | ema200 | 231 | 51% | +$88.76 | −$231 | **−$142.27** | −$0.62 |
| 12:00 | none | 365 | 56% | +$38.71 | −$365 | −$326.23 | −$0.89 |
| 12:00 | utbot | 224 | 56% | +$12.28 | −$224 | −$211.67 | −$0.94 |
| 12:00 | ema200 | 231 | 55% | −$7.43 | −$231 | −$238.37 | −$1.03 |

## Takeaway

**Neither lever rescues the BTC short — every cell is net-negative.**

1. **Exit 04:00 is the wrong window for a short.** 00:00→04:00 UTC is the *up*-drift window (the LONG
   sweet spot), so shorting into it fights the drift → gross collapses to ~$0. The short's best window
   is **08:00** (gross +$126); 12:00 gives the gains back.
2. **The 1D bear filter doesn't help.** It cuts ~40% of trades (fees $365→$224) but cuts *gross by more*
   (+$126 → +$69 UTBot / +$89 EMA200), so net/trade is flat at ≈−$0.65. Best cell (08:00 + EMA200) is
   still −$142.

**Root cause — the key finding:** BTC's intraday drift edge is simply too small *in % terms* to clear
the fee hurdle, at any size:
- BTC short best gross = $126 / 365 / $1000 = **0.034%/trade**
- SOL long (the net-positive strategy) = $42.50 / 365 / $100 = **0.116%/trade**

Round-trip fee is **0.1%/trade regardless of size**. SOL/BNB beat it; BTC (0.034%) cannot. Sizing is
irrelevant — edge and fee are both %-based. The no-stop structure compounds it: at 08:00 only ~18% of
forced closes are green (losers run unbounded, winners capped at $500).

**Verdict: BTC clock-short is not tradeable — its % edge is below the fee floor.** The only viable
clock trade found remains **long the high-beta alts (SOL/BNB) at 00:00→04:00 with a 1D-bull filter**,
because those have the larger % intraday range BTC lacks.
