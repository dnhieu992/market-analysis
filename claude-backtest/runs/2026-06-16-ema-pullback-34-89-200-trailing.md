# EMA 34/89/200 Pullback + ATR Trailing Stop — backtest

**Date:** 2026-06-16
**Script:** `scripts/run-ema-pullback-backtest.ts` (new)

## Strategy
Triple-EMA pullback entry with an ATR trailing-stop exit:
- **LONG**: stack `close > EMA34 > EMA89 > EMA200`; enter when a candle pulls back
  to EMA34 (`low <= EMA34`) but closes back above it. Take profit via ATR trailing
  stop (ratchets up, exit at stop when a later `low <= stop`). **Forced exit** when
  a candle **closes below EMA34**.
- **SHORT**: mirror image (`close < EMA34 < EMA89 < EMA200`, `high >= EMA34` entry,
  trailing ratchets down, forced exit on close above EMA34).
- One position at a time, flat between setups. $1000 compounded. Fee 0.05%/side on
  both sides of each trade. Trailing fills assumed at the stop price.

## Commands
```bash
# H4, 1 year, sweep trailing ATR x2 / x3
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 4h 365 1000 0.05 "34,89,200" "2,3" 10

# D1, 2 years, sweep trailing ATR x2 / x3
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-ema-pullback-backtest.ts "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 1d 730 1000 0.05 "34,89,200" "2,3" 14
```

## Results — H4, 365d
**ATR(10)x2 trail**
| symbol | trades | trailExits | winRate | return% | maxDD% | expo% |
|--------|-------:|-----------:|--------:|--------:|-------:|------:|
| BTC | 83 | 27 | 20.5% | -11.37 | 25.5 | 30.5 |
| ETH | 94 | 28 | 16.0% | -9.23 | 33.0 | 34.9 |
| SOL | 97 | 32 | 22.7% | +0.60 | 29.4 | 38.6 |
| BNB | 87 | 30 | 28.7% | -4.87 | 13.9 | 34.0 |
| XRP | 97 | 32 | 25.8% | +5.42 | 16.8 | 40.7 |

**ATR(10)x3 trail** — BTC -10.69, ETH -9.63, SOL -5.54, BNB +13.84, XRP -12.58.

## Results — D1, 730d
**ATR(14)x2 trail** ← best overall
| symbol | trades | trailExits | winRate | return% | maxDD% | expo% |
|--------|-------:|-----------:|--------:|--------:|-------:|------:|
| BTC | 19 | 8 | 42.1% | **+16.92** | 8.47 | 32.1 |
| ETH | 16 | 6 | 18.8% | -0.54 | 25.8 | 24.2 |
| SOL | 22 | 7 | 31.8% | **+35.54** | 20.6 | 39.6 |
| BNB | 18 | 5 | 27.8% | **+27.30** | 15.4 | 32.5 |
| XRP | 23 | 5 | 21.7% | **-40.15** | 58.8 | 33.2 |

**ATR(14)x3 trail** — BTC +9.93, ETH -4.07, SOL +8.15, BNB +12.47, XRP -54.39.

## Takeaway
**Timeframe matters far more than the trailing multiplier.** On **H4 the strategy
fails** — in a trend price rides EMA34, so `low <= EMA34` fires almost every bar,
producing 80–100 trades/yr, ~15–29% win rate, and fee-bled negative returns.

On **D1 with ATR(14)x2 it is the best variant tested so far**: BTC +16.9% at only
**8.5% maxDD** (best risk-adjusted of any run), SOL +35.5%, BNB +27.3%. The trailing
stop earns its keep — 30–45% of exits are trailing (locking profit) rather than the
EMA34 close, unlike the plain ribbon. **ATR x2 beats x3** (tighter trail captures more).

**Caveat:** XRP is a disaster on D1 (-40% / 58.8% DD) — it spent the window in messy
range/downtrend where the stack kept flipping. Like the ribbon variant, results are
coin-dependent: great on clean trenders (BTC/SOL/BNB), poor on choppy alts. Use this
on **D1 only**, ideally filtered to strong trending coins.

Possible next steps: require a fresh pullback (prior bar extended above EMA34, not
continuous EMA34-riding) to cut H4 over-trading; or add a regime filter (skip when
EMA34/EMA200 spread is small / price chopping around EMA200).
