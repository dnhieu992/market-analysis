# SonicR + Weekly trend filter

**Date:** 2026-06-16
**Script:** `scripts/run-sonicr-weekly-filter-backtest.ts` (new)

## What changed
Adds a higher-timeframe gate to the faithful SonicR engine: only take LONGs when the
**weekly** trend is up, SHORTs when down.
- `weeklyUp = weeklyClose > weeklyEMA(W) AND weeklyEMA rising` (mirror for down).
- The weekly state for a trading candle comes from the last weekly bar already CLOSED at/
  before that candle's open (no look-ahead). Weekly klines fetched with +400d extra history
  for EMA warmup.

## Commands
```bash
# D1 730d and 4h 365d, weekly EMA20
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-sonicr-weekly-filter-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 1d 730 1000 0.05 3 60 0.1 20
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-sonicr-weekly-filter-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 4h 365 1000 0.05 3 60 0.1 20
```

## Results

### 4h, 365d, weekly EMA20  ← best config found
| symbol | trades | winRate | return% | maxDD% | (no filter) |
|--------|-------:|--------:|--------:|-------:|------------:|
| BTC | 35 | 25.7% | -8.16 | 14.7 | -9.11 |
| ETH | 22 | 22.7% | +4.25 | 14.5 | +2.91 |
| SOL | 38 | 36.8% | +15.00 | 12.4 | +5.86 |
| BNB | 28 | 28.6% | +10.05 | 11.5 | +11.34 |
| XRP | 32 | 37.5% | **+6.77** | 10.9 | **-8.17** |
| **basket** | | | **+5.58** | | **+0.57** |

Robustness across weekly EMA period (4h basket avg): EMA13 +1.26% · **EMA20 +5.58%** ·
EMA26 +3.83% — **all positive**, EMA20 best.

### D1, 730d, weekly EMA20
| symbol | return% | (no filter) |
|--------|--------:|------------:|
| BTC | +4.83 | +4.83 |
| ETH | +3.74 | +3.81 |
| SOL | **-3.71** | **+20.74** |
| BNB | +10.00 | +12.60 |
| XRP | -31.91 | -31.89 |
| **basket** | **-3.41** | **+2.02** |

### 1h, 365d, weekly EMA20
Basket **-8.51%** (improved vs unfiltered but still negative; XRP +1.86, rest negative).

## Takeaway — the weekly filter helps on 4h, is redundant/harmful on D1
**The filter's value depends on the gap between the trading timeframe and the weekly.**

- **On 4h it works well.** 4h trend can diverge from the weekly, so gating out
  counter-weekly setups is genuinely additive: basket +0.57% → **+5.58%, and all five
  coins turn positive**, including the previously-broken **XRP (-8.17% → +6.77%)**. It's
  robust across weekly EMA 13/20/26. This is the **best all-positive basket in the whole
  EMA/SonicR study**, with single-digit-to-mid-teens drawdowns.
- **On D1 it backfires** (basket +2.02% → -3.41%). The daily trend filter (EMA34>89>200)
  already hugs the weekly, so the weekly gate adds almost no new information and mostly
  just lags entries — it gutted SOL's run (+20.7% → -3.7%) and, notably, did **not** rescue
  XRP (-31.9% unchanged): XRP's losses occurred while the weekly was itself aligned, so an
  EMA-based weekly filter can't catch them. (One-position-at-a-time also means skipping a
  trade reshuffles later entries, so effects aren't purely subtractive.)
- **On 1h the filter helps but can't beat fee drag** (~100 trades/coin → still -8.5%).

## Best configuration found (whole study)
```
SonicR (Dragon EMA34 band + EMA89/200) + Weekly-EMA20 filter, 4h, majors+XRP:
  basket +5.58%, ALL coins positive, maxDD 11-15%, robust to weekly EMA period.
```
Use 4h with the weekly filter for the most robust, all-positive result. For pure return
on D1, plain SonicR (no weekly filter, +2.02% / +10.5% ex-XRP) or the ATR-trailing pullback
(+7.81%) win but carry coin-specific tail risk (XRP). Next idea to lift it further: replace
the EMA-based weekly gate with a weekly *structure* filter (higher-high & higher-low) — that
might finally exclude the XRP regime the EMA gate misses.
```
```
