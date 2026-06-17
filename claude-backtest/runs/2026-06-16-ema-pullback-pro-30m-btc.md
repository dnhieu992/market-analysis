# EMA 34/89/200 Pullback PRO rule set — 30m BTC (improved but still negative)

**Date:** 2026-06-16
**Script:** `scripts/run-ema-pullback-pro-backtest.ts` (new)

## Rule (exact, as specified)
- **Trend filter:** EMA34>EMA89>EMA200, EMA34 & EMA89 both sloping up, close>EMA200.
- **Entry LONG (2 candles):** pullback candle `low<=EMA34 AND close>=EMA89`; next candle
  `close>open AND close>EMA34` → enter at confirmation close.
- **Stop:** `min(pullback low, EMA89) × (1 − 0.1%)`.
- **TP:** TP1 = entry+1.5R close 50%; TP2 = entry+3.0R close other 50% (R = entry−SL).
- **Early exit (on close, remaining):** EMA34<EMA89 OR close<EMA89.
- **Filters:** |close−EMA34|/EMA34 ≤ 1.5%; one position at a time.
- Long-only (rule as given). $1000 compounded, fee 0.05%/side on entry + each scale-out.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-pro-backtest.ts BTCUSDT 30m 365 1000 0.05 "34,89,200" 1.5 1.5 3 0.1
```

## Results — BTC, same rule, across timeframes (365d)
| TF | trades | tp1 | tp2 | sl | early | winRate | return% | maxDD% |
|----|-------:|----:|----:|---:|------:|--------:|--------:|-------:|
| **30m** | 150 | 50 | 30 | 47 | 73 | 32.0% | **-20.43** | 23.2 |
| 1h | 77 | 27 | 16 | 24 | 36 | 36.4% | -4.50 | 13.2 |
| 2h | 28 | 9 | 7 | 8 | 13 | 32.1% | -6.14 | 13.6 |
| 4h | 12 | 5 | 3 | 4 | 5 | 50.0% | +0.62 | 7.2 |

BTC 30m recent 180d: 68 trades, 30.9% WR, **-15.26%**, 17.5% maxDD.

## Takeaway
The strict PRO rule set is a **big improvement over the loose 30m versions** — it cut BTC
30m trade count from ~480 to **150** and maxDD from ~48% to 23%. But it is **still
net-negative on 30m: -20.4%/yr** (and -15.3% over the recent 180d, so not just one bad
regime).

Same monotonic timeframe pattern as every other EMA variant: 30m (-20%) < 2h (-6%)
< 1h (-4.5%) < 4h (~breakeven, +0.6%). Even with this much tighter rule, 30m can't beat
the fee/noise drag.

Two structural leaks specific to this rule:
- **Early exit on `close<EMA89` fires on ~half of all trades** (73/150 on 30m) and is
  mostly a small scratch/loss — it ejects positions before TP1/TP2 can print. On 30m the
  price wicks below EMA89 constantly.
- **SL at min(low,EMA89)−0.1% is tight** on 30m: 47 stop-outs. Tight stop + frequent
  early exit means winners rarely reach the 3R TP2 (only 30 of 150 hit TP2).

**Verdict for "30m BTC": not profitable as written.** Best timeframe for this rule is
**4h** (and even there only breakeven). The earlier D1 pullback + ATR-trailing variant
(+7.81% basket) remains the only positive EMA-34/89/200 configuration found.

If pushing the 30m version further, the highest-leverage change is the early-exit:
loosen it (e.g. only exit when a candle *closes* below EMA89 by a buffer, or only on the
EMA34<EMA89 cross) so trades survive normal 30m noise long enough to reach TP.
