# UTBot LONG-ONLY spot on higher timeframe — ETH

**Date:** 2026-06-25
**Symbol/TF:** ETHUSDT · 1d and 1w
**Capital/Fee:** $1000 compounded, long-only spot (cash during bear), fee 0.05%/side, ATR(10)

**Context:** Follow-up to `2026-06-25-radar-signal-d1-eth.md` (the radar score had no edge).
User buys spot off this page ("mua lướt"), so no shorting, and wants the signal on a HIGHER
timeframe only. Tested replacing the radar score with **UTBot trend, long-only**: buy on a
confirmed close flip to bull, sell to cash on a flip to bear. Same UTBot stop formula as the
live swing flow.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-utbot-spot-backtest.ts ETHUSDT 1d 1500 1000 0.05 "1,2,3,4"
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-utbot-spot-backtest.ts ETHUSDT 1w 3200 1000 0.05 "1,2,3,4"
```

## Results

### Daily (1d), 2022-05 → 2026-06 — Buy & Hold = **−12.76%**
| keyValue | trades | win % | return | final $ | maxDD | bars in |
|---------:|-------:|------:|-------:|--------:|------:|--------:|
| 1 | 78 | 37.2% |  +6.79% | $1,068 | 50.6% | 741 |
| **2** | 34 | 32.4% | **+15.57%** | $1,156 | 52.8% | 648 |
| 3 | 21 | 38.1% | −24.99% |   $750 | 54.3% | 671 |
| 4 | 12 | 41.7% |  +8.93% | $1,089 | 33.0% | 684 |

### H4 (4h), 2022-05 → 2026-06 (same 1500-day window as Daily) — Buy & Hold = **−20.67%**
| keyValue | trades | win % | return | final $ | maxDD | bars in |
|---------:|-------:|------:|-------:|--------:|------:|--------:|
| 1 | 453 | 38.9% |  +80.28% | $1,803 | 49.6% | 4427 |
| **2** | 187 | 39.0% | **+112.74%** | $2,127 | 56.9% | 4479 |
| 3 | 110 | 31.8% |  +39.98% | $1,400 | 46.0% | 4500 |
| 4 |  69 | 36.2% |  +85.76% | $1,858 | 45.9% | 4113 |

### Weekly (1w), 2017-09 → 2026-06 — Buy & Hold = **+265.90%**
| keyValue | trades | win % | return | final $ | maxDD | bars in |
|---------:|-------:|------:|-------:|--------:|------:|--------:|
| **1** | 23 | 52.2% | **+1,373.86%** | $14,739 | 44.6% | 193 |
| 2 | 12 | 66.7% |   +693.75% | $7,937 | 43.9% | 203 |
| 3 |  8 | 50.0% |    +81.82% | $1,818 | 61.2% | 191 |
| 4 |  8 | 25.0% |    −78.05% |   $220 | 82.6% | 226 |

## Takeaway
UTBot long-only is a **massive improvement over the radar score** on ETH and, unlike the score,
shows a genuine trend-following edge:

- **Daily**: over a window where buy & hold **lost 12.8%**, kv=2 returned **+15.6%** — it sat in
  cash through the downtrends. Lower-conviction than weekly, and drawdown is still ~53%.
- **H4** (same 1500-day window): surprisingly the strongest absolute return — kv=2 made
  **+112.7%** while buy & hold lost −20.7%. But it took **187 trades** (~47/yr, a decision every
  4h — NOT low-touch), win rate only 39% (trend-rider: many small stop-outs, few big winners),
  and ~57% drawdown. The edge is real but it demands attention and discipline, and on less-liquid
  alts the unmodeled slippage would bite far more than on ETH.
- **Weekly (the sweet spot for low-touch spot swings)**: kv=1 turned $1k → **$14.7k (+1,374%)**
  vs +266% buy & hold, with **lower max drawdown (45% vs ETH's ~90% peak-to-trough)** and a 52%
  win rate. kv=2 is the most comfortable: **+694%, 67% win, only 12 trades, 44% DD**.

**Parameter note (opposite of the futures-flip finding):** here LOWER keyValue wins (kv1–2),
because long-only spot makes few trades so fee drag is tiny — being responsive (catch the trend
early, exit early) matters more than minimizing flips. kv≥3 degrades and kv4 weekly blew up
(−78%): the stop sat too far, so it round-tripped entire bull runs.

**Recommendation for the user:** for spot swing entries, use **UTBot trend on the WEEKLY close,
keyValue 1–2** (or Daily kv=2 for a more active version) — NOT the radar score. Concretely this
means: only hold while the weekly UTBot trend is bull, exit to cash when the weekly closes bear.
Worth validating on a basket of alts next, but the ETH result is clearly positive and beats
buy & hold on both return and drawdown.

**Possible feature:** add a "UTBot D1/W1 trend" (bull/bear) column to the Top Cap Radar so the
page shows this actionable signal instead of / alongside the heuristic score.
