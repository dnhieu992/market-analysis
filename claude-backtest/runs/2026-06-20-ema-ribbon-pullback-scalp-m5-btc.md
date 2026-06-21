# EMA Ribbon Pullback Scalp (M5) — BTCUSDT

**Date:** 2026-06-20
**Context:** User has small capital, asked whether a high-frequency scalping strategy could compensate. Tested EMA Ribbon Pullback on M5 — specifically to check whether the edge **survives fees**.

## Rules
- Ribbon EMA 9/21/55. Trend up = 9>21>55, down = 9<21<55.
- Pullback arm: price dips to/through EMA9 within trend; entry on confirming close back across EMA9 (bullish/bearish body).
- SL = pullback extreme ± 0.05% buffer (capped at 1.5% risk). TP = rr × risk. SL assumed first if both hit same candle.
- Trend flip against position also closes it. One position at a time, $1000 compounded, no leverage.

## Script
`scripts/run-ema-ribbon-pullback-scalp.ts` (new).
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-ribbon-pullback-scalp.ts BTCUSDT 5m 90 1000 <fee> "9,21,55" "1,1.5,2,3" 0.05 1.5
```

## Results — BTC M5, 90 days (2026-03-22 → 2026-06-20)

### WITH real fee (0.05%/side = 0.1% round-trip)
| rr  | trades | winRate | final$  | return% | maxDD% |
|-----|--------|---------|---------|---------|--------|
| 1.0 | 1617   | 46.01%  | $178.13 | -82.19  | 82.24  |
| 1.5 | 1316   | 38.15%  | $247.94 | -75.21  | 75.47  |
| 2.0 | 1103   | 31.64%  | $322.40 | -67.76  | 68.00  |
| 3.0 | 917    | 23.88%  | $363.61 | -63.64  | 63.93  |

### WITHOUT fee (0%/side — raw edge)
| rr  | trades | winRate | final$  | return% | maxDD% |
|-----|--------|---------|---------|---------|--------|
| 1.0 | 1617   | 48.55%  | $898.25 | -10.18  | 13.40  |
| 1.5 | 1316   | 38.83%  | $925.11 | -7.49   | 12.00  |
| 2.0 | 1103   | 32.46%  | $972.03 | **-2.80** | 13.60 |
| 3.0 | 917    | 24.97%  | $910.19 | -8.98   | 16.47  |

## Results — EMA 8/13/21 variant (faster ribbon), BTC M5, 90 days

### WITH real fee (0.05%/side)
| rr  | trades | winRate | final$  | return% | maxDD% |
|-----|--------|---------|---------|---------|--------|
| 1.0 | 2129   | 44.15%  | $99.84  | -90.02  | 90.02  |
| 1.5 | 1758   | 37.20%  | $161.92 | -83.81  | 83.83  |
| 2.0 | 1538   | 30.36%  | $199.58 | -80.04  | 80.08  |
| 3.0 | 1335   | 23.45%  | $237.37 | -76.26  | 76.42  |

### WITHOUT fee (0%/side — raw edge)
| rr  | trades | winRate | final$  | return% | maxDD% |
|-----|--------|---------|---------|---------|--------|
| 1.0 | 2129   | 47.11%  | $840.36 | -15.96  | 16.74  |
| 1.5 | 1758   | 38.11%  | $940.19 | **-5.98** | 13.47 |
| 2.0 | 1538   | 31.99%  | $929.89 | -7.01   | 14.46  |
| 3.0 | 1335   | 26.37%  | $902.73 | -9.73   | 15.53  |

→ The faster 8/13/21 ribbon arms/fires even MORE (up to 2129 trades vs 1617), so fee drag is
worse (-76% to -90%). Raw edge is still negative (best -5.98% at 0% fee). Same verdict, more extreme.

## Takeaway — fees kill it
Even at **0% fee** the strategy has **no positive edge** (best case -2.8% over 90 days) — the EMA9 pullback on M5 BTC is essentially noise. Adding the real 0.05%/side fee turns it **catastrophic: -64% to -82%**.

The mechanism is exactly the "fee trap" warned about: 900–1600 trades × 0.1% round-trip = **90%–160% of equity paid in fees** over 90 days. High trade frequency does NOT compensate for small capital — it *amplifies* fee drag.

**Conclusion for the user:** do not scalp M5 to "make up for" small capital. The path for small accounts is **fewer, higher-quality trades on higher timeframes** (the H4 breakout lookback=55 config from `2026-06-20-breakout-donchian-volume-btc.md` returned +61.8% with 39 trades/yr) plus sensible position sizing — not trade frequency. If scalping is still desired, it would need (a) maker/rebate fees, not taker, and (b) a genuinely predictive entry, neither of which this M5 ribbon pullback provides.
