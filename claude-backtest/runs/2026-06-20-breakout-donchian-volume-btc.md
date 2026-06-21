# Breakout (Donchian channel + volume) — BTCUSDT

**Date:** 2026-06-20
**Strategy:** #3 from "3 famous internet coin-trading strategies" — Breakout (phá vỡ kháng cự/hỗ trợ + xác nhận volume).

## Rules
- `resistance` = highest HIGH of previous `lookback` candles; `support` = lowest LOW.
- `avgVol` = mean volume of previous `lookback` candles.
- **LONG** when a candle CLOSES above resistance AND `volume > volMult × avgVol`.
- **SHORT** when a candle CLOSES below support AND `volume > volMult × avgVol`.
- Fixed **SL** / **TP** as % of entry, checked intra-candle (SL assumed first if both hit same candle).
- Opposite breakout while in position closes it (flip).
- One position at a time, $1000 compounded, no leverage.
- Fee **0.05%/side** (0.1% round-trip). Excludes slippage & funding.

## Script
`scripts/run-breakout-backtest.ts` (new). Fetches public Binance klines, no auth.

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-breakout-backtest.ts <symbol> <interval> <days> <capital> <feePerSide> <lookbackList> <volMult> <slPct> <tpPct>
```

## Results

### H4, 1 year (2025-06-20 → 2026-06-20), volMult=1.5, SL=3% / TP=6% (2R)
| lookback | trades | winRate | final$    | return% | maxDD% |
|----------|--------|---------|-----------|---------|--------|
| 20       | 63     | 41.27%  | $1,263.19 | +26.32% | 20.24% |
| 30       | 55     | 40.00%  | $1,294.61 | +29.46% | 20.52% |
| **55**   | **39** | **48.72%** | **$1,618.19** | **+61.82%** | **11.84%** |

Best (lookback=55) exit breakdown: TP=19, SL=18, flip=2.

### H4, lookback=55, higher RR — SL=3% / TP=9% (3R), volMult=1.5
| lookback | trades | winRate | final$    | return% | maxDD% |
|----------|--------|---------|-----------|---------|--------|
| 55       | 31     | 35.48%  | $1,292.22 | +29.22% | 19.62% |

→ Pushing TP to 3R **lowered** return (fewer TP hits). 2R was the sweet spot.

### H4, lookback=55, NO volume filter (volMult=0), SL=3% / TP=6%
| lookback | trades | winRate | final$    | return% | maxDD% |
|----------|--------|---------|-----------|---------|--------|
| 55       | 43     | 46.51%  | $1,568.45 | +56.85% | 17.22% |

→ Volume filter helped: +61.82% vs +56.85%, and cut maxDD 17.2%→11.8% (fewer false breakouts).

### 1D, 1 year, volMult=1.5, SL=5% / TP=10% (2R)
| lookback | trades | winRate | final$    | return% | maxDD% |
|----------|--------|---------|-----------|---------|--------|
| 20       | 16     | 31.25%  | $901.40   | -9.86%  | 23.82% |
| 30       | 13     | 38.46%  | $1,054.67 | +5.47%  | 15.41% |
| 55       | 7      | 42.86%  | $1,076.61 | +7.66%  | 5.10%  |

→ On 1D the sample is tiny (7–16 trades) and edge is weak this year.

## Takeaway
The breakout strategy is **only profitable with a wide channel (lookback=55) on H4** this past year: +61.82% net of fees with a 11.84% max drawdown and ~49% win rate — typical breakout profile (sub-50% wins carried by 2R winners). Short lookbacks (20–30) generate far more trades but get chopped up (more false breakouts, higher DD, lower return). The volume filter (1.5×) measurably reduced false breakouts. Daily timeframe had too few signals to be reliable this year. As always, results exclude slippage/funding, so live performance on perps would be lower. **Recommended config: H4, lookback=55, volMult=1.5×, SL=3% / TP=6% (2R).**
