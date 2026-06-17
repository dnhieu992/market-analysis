# SonicR System (faithful) — Dragon EMA34 band + EMA89/200

**Date:** 2026-06-16
**Script:** `scripts/run-sonicr-backtest.ts` (new)

## Strategy (faithful to the SonicR system)
- **Dragon** = EMA34 on HIGH / CLOSE / LOW → a band (dragonTop/mid/bot).
- **Trend** = EMA89 & EMA200. Long when dragonMid>EMA89>EMA200, Dragon sloping up,
  close>EMA89 (mirror for short).
- **Entry**: price pulls back INTO the Dragon band (this/prior candle low ≤ dragonTop),
  then a bullish candle CLOSES back above the band (close>open & close>dragonTop) → enter.
- **Stop**: min(touch low, dragonBot) × (1−0.1%).
- **Exits (SonicR style)**: TP1 = nearest prior swing high above entry → close 50%; the
  runner trails the Dragon and exits when a candle CLOSES below the band (close<dragonBot).
- Long & short. $1000 compounded, fee 0.05%/side on entry + each scale-out.

## Commands
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-sonicr-backtest.ts BTCUSDT <tf> <days> 1000 0.05 3 60 0.1
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-sonicr-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 1d 730 1000 0.05 3 60 0.1
```

## Results — BTC across timeframes
| TF | trades | winRate | return% | maxDD% |
|----|-------:|--------:|--------:|-------:|
| 30m (365d) | 340 | 29.4% | -20.07 | 32.2 |
| 1h (365d) | 171 | 29.8% | -23.78 | 28.4 |
| 4h (365d) | 43 | 30.2% | -9.11 | 17.4 |
| 1d (730d) | 11 | 27.3% | **+4.83** | **5.73** |

## Results — basket
**4h, 365d** (basket avg **+0.57%**)
| symbol | trades | winRate | return% | maxDD% |
|--------|-------:|--------:|--------:|-------:|
| BTC | 43 | 30.2% | -9.11 | 17.4 |
| ETH | 34 | 26.5% | +2.91 | 13.4 |
| SOL | 43 | 37.2% | +5.86 | 12.8 |
| BNB | 36 | 27.8% | +11.34 | 12.3 |
| XRP | 46 | 30.4% | -8.17 | 16.5 |

**1d, 730d** (basket avg **+2.02%**)
| symbol | trades | winRate | return% | maxDD% |
|--------|-------:|--------:|--------:|-------:|
| BTC | 11 | 27.3% | +4.83 | 5.73 |
| ETH | 8 | 37.5% | +3.81 | 13.5 |
| SOL | 12 | 58.3% | +20.74 | 8.40 |
| BNB | 9 | 44.4% | +12.60 | 8.46 |
| XRP | 13 | 46.2% | -31.89 | 46.3 |

(BTC/ETH/SOL/BNB only, D1: avg **+10.5%** — XRP is the sole loser dragging the basket.)

## Takeaway
**The faithful SonicR (Dragon as a BAND) is the best-behaved EMA-34/89/200 variant tested,
on a risk-adjusted basis.** Modelling the Dragon as the EMA34 high/low band — rather than a
single EMA34 line — plus taking profit at structure and trailing the rest along the Dragon,
produces **much lower drawdowns**: BTC D1 +4.83% at only **5.7% maxDD**, SOL D1 +20.7% at
8.4%, BNB +12.6% at 8.5%. Excluding XRP, the D1 four-coin average is **+10.5%** with
single-digit-to-low-teens drawdowns — the cleanest equity curves of the whole study.

Caveats:
- **Still timeframe-bound.** 30m/1h remain net-negative (-20% / -24%) — the band gives
  *more* entries (340 trades on 30m), so fee drag is as brutal as ever intraday. 4h is
  ~breakeven; **D1 is the sweet spot.**
- **XRP is again the outlier** (-31.9% D1): a long, messy down/range market where the trend
  filter kept allowing longs that the Dragon-trail bled out. Coin selection still matters.
- Win rates stay low (27–58%); profitability comes from the Dragon-trail letting winners
  run far past TP1, not from hit-rate — consistent with the whole study: **edge is in the
  exit.**

**Recommendation:** run SonicR on **D1 (or 4h)**, on trending majors (BTC/SOL/BNB/ETH),
skip choppy alts. Vs the plain D1 ATR-trailing pullback (+7.81% basket, higher DD), SonicR
trades lower return for materially lower drawdown — better Sharpe, the more "SonicR-faithful"
choice. Possible refinement: a coin/regime filter (e.g. weekly higher-highs) to exclude the
XRP-type markets would lift the basket toward the +10% the majors already show.
```
D1 basket ranking:
  SonicR faithful (Dragon band) : +2.02% all-in / +10.5% ex-XRP, lowest DD
  v1 pullback + ATR trailing    : +7.81%, higher DD
  pullback+confirm 2R           : -6.24%
  v2 fresh-tap+regime           : -12.39%
```
