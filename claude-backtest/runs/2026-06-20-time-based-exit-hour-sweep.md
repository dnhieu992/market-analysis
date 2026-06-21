# Time-based LONG @ 00:00 UTC — exit-hour sweep (find the sweet spot)

**Date:** 2026-06-20
**Script:** `scripts/run-time-based-0000-long-backtest.ts` (sweeping the `exitHour` arg)
**Window:** 365 days · `1h` candles · $100 fixed/trade (NO compounding) · fee 0.05%/side
**Context:** follow-up to `…-exit0800.md`. Strategy = LONG the 00:00 UTC open, +2% TP, no stop,
force-close at a fixed hour. Sweeping the force-close hour 01:00→11:00 to find where the gross edge
peaks. Fee is constant (~$146/yr for 1460 trades) so GROSS shows the true edge.

## Command (looped over h)
```bash
scripts/run-time-based-0000-long-backtest.ts 365 0    100 2 <h>   # gross
scripts/run-time-based-0000-long-backtest.ts 365 0.05 100 2 <h>   # net
```

## Sweep — totals across all 4 symbols (1460 trades)

| exit UTC | GROSS | NET | TP hit% |
|---------:|------:|----:|--------:|
| 01:00 | +$34.66 | −$111.34 | 1.3% |
| 02:00 | +$74.67 | −$71.36 | 4.0% |
| 03:00 | +$89.31 | −$56.75 | 7.5% |
| **04:00** ⭐ | **+$112.22** | **−$33.86** | 9.6% |
| 05:00 | +$97.59 | −$48.47 | 11.5% |
| 06:00 | +$56.34 | −$89.68 | 13.8% |
| 07:00 | +$26.02 | −$119.97 | 14.9% |
| 08:00 | +$36.37 | −$109.63 | 16.6% |
| 09:00 | +$34.97 | −$111.03 | 19.1% |
| 10:00 | +$21.50 | −$124.49 | 20.3% |
| 11:00 | −$15.34 | −$161.29 | 21.0% |

## Per-symbol at the sweet spot (exit 04:00)

| symbol | GROSS | NET |
|--------|------:|----:|
| BTCUSDT | +$8.79 | −$27.71 |
| ETHUSDT | +$23.73 | −$12.79 |
| BNBUSDT | +$37.21 | **+$0.68** |
| SOLUSDT | +$42.50 | **+$5.97** |

## Takeaway

**Sweet spot = exit 04:00 UTC.** Gross peaks at +$112 and net is least-bad at −$34. The positive
drift is concentrated in the **00:00→04:00 UTC window** (Asian morning) — holding past 04:00
monotonically gives the gains back (gross decays 04:00 +$112 → 11:00 −$15). The +2% TP is almost
irrelevant here (fires 1–10% at these short windows); the time-exit does all the work.

**Even at the optimum, fees still dominate at the portfolio level** (gross +$112 vs −$146 fees → net
−$34). BUT per-symbol at 04:00, **all four are gross-positive** and the two strongest — **SOL (+$5.97
net) and BNB (+$0.68 net)** — clear the fee hurdle. BTC/ETH have a real but too-small edge that fees
eat.

**Verdict:** the only net-positive cut is **exit 04:00 UTC, traded on SOL + BNB only** (~+$6.65/yr on
$100 size — positive but tiny, not worth trading alone). The finding that matters: there is a
**genuine, exploitable 00:00–04:00 UTC long drift** on the high-beta alts (SOL/BNB strongest). To turn
it into something real, combine it with a bigger edge source — e.g. only take the 04:00 trade on days
the 1d trend is bull, or use it as a timing overlay on the existing UTBot book rather than a
standalone fixed-TP system. As a pure clock trade it's at-breakeven, fee-limited.
