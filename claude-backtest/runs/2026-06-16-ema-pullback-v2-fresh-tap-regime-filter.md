# EMA 34/89/200 Pullback v2 — Fresh-tap + Regime filters (NEGATIVE result)

**Date:** 2026-06-16
**Script:** `scripts/run-ema-pullback-v2-backtest.ts` (new)

## What changed vs v1
Two filters added on top of the v1 pullback+trailing strategy:
1. **Fresh tap** — only enter on the *first* touch of EMA34: previous candle's low must
   be strictly above its EMA34 (mirror for shorts). Stops continuous re-entry while price
   rides the line.
2. **Regime filter** — only trade when `|EMA34 − EMA200| / EMA200 >= minSpreadPct`.

## Commands
```bash
# D1, ATR(14)x2, spread 1/2/3%
for sp in 1 2 3; do TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-v2-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 1d 730 1000 0.05 "34,89,200" "2" 14 $sp; done
# H4, ATR(10)x2, spread 1/2/3%
for sp in 1 2 3; do TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-v2-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 4h 365 1000 0.05 "34,89,200" "2" 10 $sp; done
```

## Results — D1, ATR(14)x2 (spread 1/2/3% nearly identical)
| symbol | trades | winRate | return% | maxDD% | v1 return% |
|--------|-------:|--------:|--------:|-------:|-----------:|
| BTC | 7 | 28.6% | -4.46 | 8.94 | **+16.92** |
| ETH | 5 | 20.0% | -18.88 | 18.88 | -0.54 |
| SOL | 11 | 36.4% | -3.27 | 21.81 | **+35.54** |
| BNB | 10 | 30.0% | -10.18 | 13.90 | **+27.30** |
| XRP | 11 | 27.3% | -25.14 | 29.28 | -40.15 |
| **basket avg** | | | **-12.39** | | **+7.81** |

## Results — H4, ATR(10)x2 (spread 2%)
| symbol | trades | winRate | return% | maxDD% |
|--------|-------:|--------:|--------:|-------:|
| BTC | 29 | 17.2% | -10.68 | 13.59 |
| ETH | 34 | 8.8% | -37.58 | 37.58 |
| SOL | 36 | 25.0% | -11.61 | 25.75 |
| BNB | 33 | 24.2% | +8.04 | 15.27 |
| XRP | 38 | 26.3% | +17.67 | 13.38 |
| **basket avg** | | | **-6.83** | |

## Takeaway — both filters BACKFIRED
**The refinements made performance worse, and the experiment explains *why* v1 worked.**

- **Fresh-tap filter is harmful.** It cut trade count hard (BTC D1 19→7) but flipped the
  winners to losers: BTC +16.9%→-4.5%, SOL +35.5%→-3.3%, BNB +27.3%→-10.2%. v1's edge did
  **not** come from clean first-touch entries — it came from the *repeated* re-entries
  while price rides EMA34 in a strong trend. The first tap often gets stopped out; the
  actual run is captured by the 2nd/3rd taps that v2 throws away. Filtering to "fresh"
  taps keeps the early failures and discards the continuation winners.
- **Regime filter is nearly inert.** On D1 the 1% / 2% / 3% thresholds give virtually
  identical results — when the stack is aligned, EMA34↔EMA200 spread is almost always
  already > 3%, so the filter rarely binds. It would need a much higher threshold to do
  anything, and given fresh-tap already broke the strategy, not worth sweeping further.

**Conclusion: keep v1 (D1, ATR(14)x2) as the reference.** Do NOT add the fresh-tap filter.
The v2 script is retained to document the negative result. If revisiting: the productive
direction is the opposite of filtering — allow scaling/re-entry on continuation taps
(closer to v1), and instead of gating entries, focus on a trend/coin selection filter
applied *outside* the entry logic (e.g. only run on coins making higher-highs on the weekly).
