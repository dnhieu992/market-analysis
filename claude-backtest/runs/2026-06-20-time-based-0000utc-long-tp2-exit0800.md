# Time-based: LONG @ 00:00 UTC, TP +2%, force-close 08:00 UTC, no stop

**Date:** 2026-06-20
**Script:** `scripts/run-time-based-0000-long-backtest.ts` (now takes `exitHour` arg)
**Window:** 365 days · `1h` candles · $100 fixed/trade (NO compounding) · fee 0.05%/side
**Context:** variant of `2026-06-20-time-based-0000utc-long-tp2.md` — user moved the force-close from
11:00 to **08:00 UTC** (8h hold instead of 11h). Same: LONG the 00:00 open, +2% TP, no stop.

## Command
```bash
scripts/run-time-based-0000-long-backtest.ts 365 0.05 100 2 8   # net
scripts/run-time-based-0000-long-backtest.ts 365 0    100 2 8   # gross
```

## Results — NET (fee 0.05%/side)

| symbol | trades | TP hit | TP% | forced green/total | NET $ | avg/trade |
|--------|------:|------:|----:|-------------------:|------:|----------:|
| BTCUSDT | 365 | 30 | 8% | 168/335 | −$40.73 | −$0.11 |
| ETHUSDT | 365 | 70 | 19% | 133/295 | −$28.94 | −$0.08 |
| BNBUSDT | 365 | 52 | 14% | 152/313 | −$24.34 | −$0.07 |
| SOLUSDT | 365 | 91 | 25% | 108/274 | −$15.62 | −$0.04 |
| **TOTAL** | 1460 | 243 | 16.6% | 561/1217 | **−$109.63** | **−$0.08** |

## Results — GROSS (fee = 0)

| symbol | NET $ | avg/trade |
|--------|------:|----------:|
| BTCUSDT | −$4.24 | −$0.01 |
| ETHUSDT | +$7.56 | +$0.02 |
| BNBUSDT | +$12.16 | +$0.03 |
| SOLUSDT | +$20.89 | +$0.06 |
| **TOTAL** | **+$36.37** | **+$0.02** |

## Comparison vs 11:00 exit

| exit | GROSS total | NET total | gross avg/trade |
|------|------------:|----------:|----------------:|
| 11:00 UTC | −$15.34 | −$161.29 | −$0.01 |
| **08:00 UTC** | **+$36.37** | −$109.63 | **+$0.02** |

## Takeaway

**The shorter 00:00→08:00 UTC window has a small but real positive drift** — gross flips from −$15
(11:00 exit) to **+$36** (08:00 exit), with ETH/BNB/SOL all green and only BTC marginally red. So
closing earlier (before the later-UTC session that gave the gains back) captures the Asian-session
drift better. This is the first of the clock strategies with a *positive gross edge*.

**But the edge is still smaller than fees.** +$0.02/trade gross vs a −$0.10/trade round-trip cost
(0.1% on $100) → net stays at **−$110** over the year. Fees alone (1460 × $0.10 ≈ $146) swamp the
+$36 edge.

**Verdict: directionally promising but not yet tradeable.** The 08:00 exit is strictly better than
11:00, confirming there's exploitable session structure here. To make it net-positive the edge/fee
ratio must improve — worth testing next: (a) larger size per trade (fee is % so this doesn't help the
ratio — skip), (b) **trade only the best window** (the gross gain is concentrated in SOL/BNB/ETH; drop
BTC), (c) **a regime/seasonality filter** to skip the down-drift days, or (d) hold the runner past TP
on trend days. The fixed +2% TP barely fires (8–25%) so it's the time-exit doing most of the work;
tuning the exit hour (sweep 04:00–10:00) is the cheapest next experiment.
