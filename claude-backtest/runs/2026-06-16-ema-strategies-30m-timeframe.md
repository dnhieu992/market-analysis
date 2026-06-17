# EMA 34/89/200 strategies on 30m timeframe (NEGATIVE — fee drag dominates)

**Date:** 2026-06-16
**Scripts:** `scripts/run-ema-pullback-confirm-backtest.ts`, `scripts/run-ema-pullback-backtest.ts`

## Commands
```bash
# pullback + confirmation candle, TP 2R
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-confirm-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 30m 365 1000 0.05 "34,89,200" 2 0
# pullback + ATR(10)x2 trailing (v1)
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 30m 365 1000 0.05 "34,89,200" "2" 10
```

## Results — 30m, 365d

**Pullback + confirmation, TP 2R**
| symbol | trades | winRate | avgR (gross) | return% (net) | maxDD% |
|--------|-------:|--------:|-------------:|--------------:|-------:|
| BTC | 483 | 37.7% | +0.13 | -41.46 | 48.5 |
| ETH | 447 | 35.8% | +0.07 | -21.12 | 38.5 |
| SOL | 504 | 35.7% | +0.07 | -19.92 | 33.1 |
| BNB | 513 | 36.3% | +0.09 | -30.37 | 35.8 |
| XRP | 529 | 34.0% | +0.02 | -33.78 | 41.9 |
| **basket** | ~495 | 35.9% | — | **-29.33** | |

**Pullback + ATR(10)x2 trailing (v1)**
| symbol | trades | winRate | return% | maxDD% |
|--------|-------:|--------:|--------:|-------:|
| BTC | 774 | 20.3% | -48.08 | 51.9 |
| ETH | 760 | 19.0% | -28.65 | 50.7 |
| SOL | 736 | 23.5% | -11.44 | 32.7 |
| BNB | 807 | 20.6% | -26.28 | 33.3 |
| XRP | 807 | 20.5% | -57.83 | 62.1 |
| **basket** | ~777 | — | **-34.5** | |

## Takeaway — 30m is the worst timeframe; fees kill it
Both strategies are deeply net-negative on 30m for every coin.

The confirmation variant is the sharper lesson: its **gross** edge is actually slightly
**positive** (win rate 34–38% > the 33.3% breakeven for 2R; avgR +0.02 to +0.13). But it
fires **~500 trades/coin/year**, and at 0.1% round-trip the fee bill is ~50% of equity —
turning a small gross edge into a -29% net basket. The trailing variant is even worse
(~780 trades, -34%): 30m noise produces constant whipsaw flips.

**Rule confirmed across all runs: trade count is the enemy.** Net return ranks strictly by
timeframe = inverse of frequency:

```
D1  pullback + ATR trailing : +7.81%   (≈18 trades/coin)   ← best
H4  pullback + ATR trailing : -3.89%   (≈90 trades/coin)
H4  pullback + confirm 2R    : -23.34% (≈60 trades/coin)
30m pullback + confirm 2R    : -29.33% (≈495 trades/coin)
30m pullback + ATR trailing  : -34.5%  (≈780 trades/coin)  ← worst
```

For this EMA 34/89/200 family, **do not go below D1**. Any intraday timeframe generates
too many setups; even a positive gross edge cannot survive 0.1%/trip fees at that
frequency. If an intraday version is required, it would need (a) far fewer, higher-quality
setups (strict regime/trend gating) and (b) much larger per-trade targets to dwarf fees —
neither of which the current rules provide.
