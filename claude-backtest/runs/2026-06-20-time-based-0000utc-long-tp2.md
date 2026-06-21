# Time-based: LONG @ 00:00 UTC, TP +2%, force-close 11:00 UTC, no stop

**Date:** 2026-06-20
**Script:** `scripts/run-time-based-0000-long-backtest.ts`
**Window:** 365 days · `1h` candles · $100 fixed/trade (NO compounding) · fee 0.05%/side
**Context:** user-specified intraday clock strategy — buy the daily open, target +2%, hard time-exit.

## Rule
Every day: LONG at the OPEN of the 00:00 UTC 1h candle. TP at +2% (filled if any candle in
00:00–10:00 trades up to entry×1.02). **No stop-loss.** If TP not hit, force-close at 11:00 UTC
(= open of the 11:00 candle). One trade/day, fixed $100 notional.

## Command
```bash
scripts/run-time-based-0000-long-backtest.ts 365 0.05 100 2   # net
scripts/run-time-based-0000-long-backtest.ts 365 0    100 2   # gross
```

## Results — NET (fee 0.05%/side)

| symbol | trades | TP hit | TP% | forced | forced green | NET $ | avg/trade |
|--------|------:|------:|----:|------:|------------:|------:|----------:|
| BTCUSDT | 365 | 38 | 10% | 327 | 159 | −$45.02 | −$0.12 |
| ETHUSDT | 365 | 89 | 24% | 276 | 115 | −$40.61 | −$0.11 |
| BNBUSDT | 365 | 70 | 19% | 295 | 126 | −$40.63 | −$0.11 |
| SOLUSDT | 365 | 109 | 30% | 256 | 88 | −$35.02 | −$0.10 |
| **TOTAL** | 1460 | 306 | 21.0% | 1154 | 488 | **−$161.29** | **−$0.11** |

## Results — GROSS (fee = 0)

| symbol | NET $ | avg/trade |
|--------|------:|----------:|
| BTCUSDT | −$8.54 | −$0.02 |
| ETHUSDT | −$4.12 | −$0.01 |
| BNBUSDT | −$4.15 | −$0.01 |
| SOLUSDT | +$1.47 | +$0.00 |
| **TOTAL** | **−$15.34** | **−$0.01** |

## Takeaway

**No edge.** The 00:00→11:00 UTC window has essentially **zero directional drift** — gross P&L is
flat (≈$0.00–0.02/trade, SOL marginally positive, the others marginally negative). With the +2% TP /
no-stop structure the trade is a coin-flip: TP fires only 10–30% of the time (BTC just 10% — its 11h
range rarely reaches 2%), and the 1154 forced exits split almost evenly green/red (488/1154 ≈ 42%
green). Because there's no stop, the forced-close losers run as deep as the move went, exactly
cancelling the capped +2% winners → flat gross.

**Fees then decide it: −$0.11/trade ≈ the round-trip cost of 0.1% on $100.** Net result is a steady
bleed of −$161 over the year (−$35 to −$45 per symbol). This is the classic "no-stop, fixed-TP,
fixed-clock" outcome: the asymmetry (cap winners at +2%, let losers run to the time-exit) is mildly
*negative* and fees do the rest.

**Verdict: not tradeable.** Buying the daily open with a 2% cap and an 11:00 time-exit has no
statistical edge on these 4 symbols. Levers that *could* matter if pursued: a much smaller/scalp TP
(higher hit rate, but fees get worse per trade), entering only on a regime/seasonality filter (e.g.
only on days where the 1d UTBot trend is bull), or the opposite asymmetry (small TP + the time-exit
as the only stop won't fix a zero-drift window). As specified, it loses.
