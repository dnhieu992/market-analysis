# BTC SHORT @ 02:00 UTC, TP −$500, force-close 08:00 UTC, no stop

**Date:** 2026-06-20
**Script:** `scripts/run-btc-short-0000-tp500-backtest.ts` (now takes `entryHour` arg)
**Window:** 365 days · `1h` · $1000 fixed/trade · fee 0.05%/side · TP −$500
**Context:** variant of the 00:00-entry short — user moved the SHORT entry to **02:00 UTC** (exit
still 08:00). Quick check whether a later entry helps.

## Command
```bash
scripts/run-btc-short-0000-tp500-backtest.ts 365 0.05 1000 500 8 2   # entryHour=2
```

## Results vs 00:00 entry

| metric | entry 02:00 | entry 00:00 |
|--------|------------:|------------:|
| trades | 365 | 365 |
| TP hit | 161 (44.1%) | 188 (51.5%) |
| GROSS | +$62.92 | +$125.63 |
| fees | −$364.97 | −$365.03 |
| **NET** | **−$302.05** | −$239.41 |
| avg/trade | −$0.83 | −$0.66 |

## Takeaway

**Entering at 02:00 is worse than 00:00.** Dropping the first two hours (00:00→02:00) shortens the
window to 6h and removes part of the down-move, so gross falls +$126 → +$63 and TP-hit drops 52%→44%;
net worsens to −$302. The BTC down-drift in this session accumulates from 00:00, so a later entry just
captures less of it. Gross +$63 = 0.017%/trade, still far below the 0.1% fee floor — net stays deeply
negative. Consistent with the broader finding: BTC's intraday % edge is below the fee hurdle and no
entry/exit-hour tweak fixes it.
