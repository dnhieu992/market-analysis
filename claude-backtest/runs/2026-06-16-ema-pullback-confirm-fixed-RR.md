# EMA 34/89/200 Pullback + Confirmation candle, fixed R:R (NEGATIVE result)

**Date:** 2026-06-16
**Script:** `scripts/run-ema-pullback-confirm-backtest.ts` (new)

## Strategy
Discretionary-style pullback with a confirmation candle and a fixed reward:risk:
- **LONG**: (1) a candle CLOSES above all 3 EMAs (close > EMA34 > EMA89 > EMA200);
  (2) price pulls back and taps EMA34 (`low <= EMA34`, may close through it) — track the
  swing low; (3) a GREEN candle closes back above EMA34 → enter at that close.
  **SL = swing low** of the pullback. **TP = entry + R_MULT × (entry − SL)**.
- **SHORT**: mirror image.
- One position at a time, setup re-forms from scratch after each exit. $1000 compounded,
  fee 0.05%/side both sides. Stop assumed hit first if SL and TP share a candle.

## Commands
```bash
# H4 365d / D1 730d, TP 2R
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-confirm-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 4h 365 1000 0.05 "34,89,200" 2 0
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-confirm-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 1d 730 1000 0.05 "34,89,200" 2 0
# D1 R sweep
... 1d 730 1000 0.05 "34,89,200" 1.5 0
... 1d 730 1000 0.05 "34,89,200" 3 0
```

## Results — H4, 365d, TP 2R
| symbol | trades | winRate | avgR | return% | maxDD% |
|--------|-------:|--------:|-----:|--------:|-------:|
| BTC | 59 | 30.5% | -0.08 | -17.79 | 27.3 |
| ETH | 60 | 23.3% | -0.30 | -51.81 | 52.9 |
| SOL | 55 | 32.7% | -0.02 | +21.51 | 38.4 |
| BNB | 56 | 33.9% | +0.04 | -43.06 | 43.1 |
| XRP | 68 | 27.9% | -0.16 | -25.56 | 28.9 |
| **basket** | | **29.7%** | | **-23.34** | |

## Results — D1, 730d (R sweep)
| R | basket avg return | avg winRate | breakeven winRate |
|---|------------------:|------------:|------------------:|
| 1.5R | -9.51% | 39.9% | 40.0% |
| **2R** | **-6.24%** | **34.4%** | **33.3%** |
| 3R | -18.38% | 24.6% | 25.0% |

D1 2R per-coin: BTC -0.83 (35.7% WR), ETH -32.00, SOL **+35.44** (43.8% WR),
BNB -7.92, XRP -25.89.

## Takeaway — no statistical edge in the entry timing
The decisive tell: at **every** R multiple the realised win rate lands **right on the
theoretical breakeven line** for that R (1.5R→~40%, 2R→~33%, 3R→~25%). That is exactly
what a setup with *no timing edge* looks like — outcomes are distributed as if entries
were random with respect to the fixed RR, so gross expectancy ≈ 0 and the 0.1%
round-trip fee tips the basket net-negative.

- H4 is worse (more setups, more fee drag): basket -23%.
- D1 2R is the least-bad (-6.2%) but still a net loser across the basket; only SOL (and
  marginally BTC) profit, repeating the coin-dependence seen in every EMA variant.
- The confirmation candle and swing-low stop do not add edge: the swing low is usually
  tight (small R distance), so chop stops you out before the 2R target prints.

**Conclusion: fixed-RR pullback+confirm is not competitive.** Of all EMA 34/89/200
variants tested, the best remains the **v1 pullback + ATR(14)×2 trailing stop on D1**
(basket +7.81%, BTC +16.9% @ 8.5% DD). Trailing — letting winners run instead of capping
at 2R — is what produced positive expectancy. The edge is in the exit, not the entry.
```
Ranking so far (D1 basket avg return):
  v1 pullback + ATR trailing  : +7.81%   ← best
  pullback+confirm 2R         : -6.24%
  v2 fresh-tap + regime filter: -12.39%
```
