# BTC SHORT — flexible TP 0.5% (vs fixed $500), no stop

**Date:** 2026-06-20
**Script:** `scripts/run-btc-short-0000-tp500-backtest.ts` (added a percentage-TP mode via the `tpPct` arg)
**Window:** 365 days · `1h` · $1000 fixed/trade · fee 0.05%/side
**Context:** user asked to make the TP **flexible at 0.5%** (scales with price) instead of a fixed $500.

## Command
```bash
# args: days fee notional tpPts exitHour entryHour tpPct   (tpPct>0 switches to % mode)
scripts/run-btc-short-0000-tp500-backtest.ts 365 0.05 1000 0 8  0 0.5
scripts/run-btc-short-0000-tp500-backtest.ts 365 0.05 1000 0 15 2 0.5
```

## Results

| config | trades | TP% | GROSS | fees | NET | net/trade |
|--------|------:|----:|------:|-----:|----:|----------:|
| TP0.5% · 00:00→08:00 | 365 | 54.8% | +$84.69 | −$365 | −$280.30 | −$0.77 |
| **TP0.5% · 02:00→15:00** | 364 | 66.2% | **+$166.41** | −$364 | **−$197.66** | −$0.54 |
| (ref) TP$500 · 02:00→15:00 | 365 | 62.9% | +$146.62 | −$364 | −$217.44 | −$0.60 |
| (ref) TP$500 · 00:00→08:00 | 365 | 51.5% | +$125.63 | −$365 | −$239.41 | −$0.66 |

## Takeaway

**The 0.5% TP slightly beats the fixed $500** on the best config (gross +$166 vs +$147, hit-rate 66%
vs 63%) — because a %-TP stays consistent across price regimes. This is **the best BTC-short variant of
the whole sweep** (net −$197.66).

**But it is still net-negative, and the reason is unchanged:** best gross +$166 / 364 / $1000 =
**0.046%/trade**, still below the **0.1% round-trip fee floor**.

Across *every* BTC-short variant tested (entry 00/02, exit 04/08/12/15, TP $500 or 0.5%, ± 1D bear
filter), the gross edge sits in a **0.02–0.046%/trade** band and never clears the 0.1% fee. No TP /
hour / filter tweak doubles BTC's intraday % edge enough to beat fees.

**Firm conclusion: the BTC clock-short cannot be profitable at 0.1% round-trip fees** — BTC's intraday
% edge is structurally too small. To make a clock trade pay you must either (a) use a higher-% range
asset (SOL/BNB, already shown net-positive on the long side), or (b) cut fees materially (maker
rebate / low-fee venue) — at ~0.02%/side the +$166 gross would flip net-positive. As specified on BTC,
it loses.
