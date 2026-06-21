# Price Action + Volume — H4

**Date:** 2026-06-20
**Script:** `scripts/run-volume-pa-backtest.ts`
**Window:** 365 days · `4h` · $1000 compounded · fee 0.05%/side
**Context:** user asked to backtest a **volume + price-action** strategy (follow-up to the
double-bottom pattern test). Pure PA reversal signals, gated by a volume spike. No UTBot.

## Strategy logic
A signal candle = a reversal PA pattern **confirmed by a volume spike** (`vol > volMult × SMA(vol,volLen)`):
- **LONG:** bullish engulfing OR hammer (long lower wick, small body up top)
- **SHORT:** bearish engulfing OR shooting star (long upper wick, small body down low)

Entry at the signal candle CLOSE. SL just past the signal candle (low for long / high for short).
TP at fixed `rr`×risk. Exit on first SL/TP touch intra-candle (SL-first if both same candle).
One position at a time, compounded.

## Commands
```bash
# [days fee cap volMult volLen rr slBuf dir]
scripts/run-volume-pa-backtest.ts 365 0.05 1000 1.5 20 2   0.1 both
scripts/run-volume-pa-backtest.ts 365 0.05 1000 1.5 20 2   0.1 long
scripts/run-volume-pa-backtest.ts 365 0.05 1000 2.0 20 1.5 0.1 both
```

## Results

**BOTH dir · vol>1.5×SMA20 · TP=2R:**

| symbol | trades | WR | return% | maxDD% | avgR |
|--------|------:|----:|--------:|-------:|-----:|
| BTCUSDT | 61 | 26.2% | −32.4% | 32.8 | −0.21 |
| ETHUSDT | 56 | 35.7% | −7.8% | 24.6 | +0.04 |
| BNBUSDT | 62 | 29.0% | −3.8% | 24.5 | −0.13 |
| SOLUSDT | 57 | 28.1% | −27.7% | 39.9 | −0.16 |
| **TOTAL** | 236 | 29.7% | — | — | **−0.12** |

**Variant totals (expectancy in R):**

| config | trades | WR | avgR |
|--------|------:|----:|-----:|
| both · vol1.5× · TP2R | 236 | 29.7% | −0.12 |
| long-only · vol1.5× · TP2R | 131 | 31.3% | −0.06 |
| both · vol2.0× · TP1.5R | 138 | 38.4% | −0.05 |

Best single cell: **ETH long-only** (WR 40%, avgR +0.20, ~breakeven return) and **ETH both·vol2.0×·TP1.5R** (WR 44%, +8.8%). Everything else negative; SOL the worst across the board.

## Takeaway

**Volume-confirmed PA reversal signals also have no edge on H4 over the last year — negative
expectancy in every config (avgR −0.05 to −0.12).** This is the same lesson as the double-bottom
test: these are **counter-trend reversal entries with no trend/regime filter**, so in a choppy tape
they get repeatedly stopped (WR 26–44%, mostly <35%). Tightening the volume filter to 2.0× and
shortening TP to 1.5R nudges the whole book toward breakeven (avgR −0.12→−0.05) — fewer, cleaner
signals help, but not enough to cross zero. Restricting to long-only removes the worst shorts but
SOL longs still bleed.

**Verdict: bare PA+volume reversal is not tradeable as-is.** Two consistent themes now across three
pattern tests (double-bottom, this): (1) **trend-following (UTBot stop-and-reverse) remains the only
edge** found on these symbols; (2) discretionary reversal patterns need a **regime filter** to be
viable. Highest-value next test: take these exact PA+volume signals **only in the direction of the
higher-TF trend** (e.g. only longs when price > EMA200 / UTBot-1d is bull), which is the standard fix
for counter-trend chop.
