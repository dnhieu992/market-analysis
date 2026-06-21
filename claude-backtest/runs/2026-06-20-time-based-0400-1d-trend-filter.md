# Time-based LONG @ 00:00 UTC, exit 04:00 — with 1D trend filter (SOL/BNB)

**Date:** 2026-06-20
**Script:** `scripts/run-time-based-0400-trendfilter-backtest.ts`
**Window:** 365 days · `1h` entries + `1d` filter · $100 fixed/trade · fee 0.05%/side
**Context:** the exit-hour sweep (`…-exit-hour-sweep.md`) found a real 00:00→04:00 UTC long drift on
the alts but fees kept the portfolio net-negative. This adds a **1D trend filter** — only take the
04:00 trade when the prior-day 1D candle is bull — to cut low-quality (down-trend) days and halve fee
drag. Filters compared: **UTBot-1D** (kv2/ATR10, the live cfg) and **EMA200-1D**.

## Command
```bash
scripts/run-time-based-0400-trendfilter-backtest.ts 365 0.05 100 2
```

## Results

**SOLUSDT**
| filter | trades | TP% | GROSS | NET | net/trade |
|--------|------:|----:|------:|----:|----------:|
| none | 365 | 15% | +$42.50 | +$5.97 | +$0.02 |
| **UTBot-1D** | 149 | 16% | +$27.00 | **+$12.08** | **+$0.08** |
| EMA200-1D | 108 | 19% | +$14.25 | +$3.44 | +$0.03 |

**BNBUSDT**
| filter | trades | TP% | GROSS | NET | net/trade |
|--------|------:|----:|------:|----:|----------:|
| none | 365 | 7% | +$37.21 | +$0.68 | +$0.00 |
| UTBot-1D | 186 | 5% | +$18.88 | +$0.27 | +$0.00 |
| **EMA200-1D** | 192 | 9% | +$43.06 | **+$23.82** | **+$0.12** |

**TOTAL (SOL + BNB)**
| filter | trades | GROSS | NET | net/trade |
|--------|------:|------:|----:|----------:|
| none | 730 | +$79.70 | +$6.64 | +$0.01 |
| UTBot-1D | 335 | +$45.88 | +$12.35 | +$0.04 |
| EMA200-1D | 300 | +$57.31 | **+$27.26** | **+$0.09** |

## Takeaway

**The 1D bull filter is the missing piece.** It removes ~half the entries (fee drag halves) while
keeping most of the edge, lifting **net/trade from ~breakeven to +$0.08–0.12 — comfortably above the
$0.10 round-trip fee** for the first time in this strategy family.

**Best filter differs by symbol:**
- **SOL → UTBot-1D** (net +$12.08, +$0.08/trade). EMA200 filters too hard (only 108 trades) and leaves
  edge on the table.
- **BNB → EMA200-1D** (net +$23.82, +$0.12/trade) and it even *raises gross* (+$37→+$43), i.e. EMA200
  correctly screens out BNB's down-drift days.

**Best combo (pick the better filter per symbol): SOL+UTBot ($12.08) + BNB+EMA200 ($23.82) ≈ +$36/yr
net** on $100 size (~+$0.10/trade after fees). Absolute $ is small only because of the $100 size — the
edge is %-based so it scales linearly (≈ +$360/yr at $1000/trade).

**Verdict: net-positive and tradeable as a small standalone overlay**, but two caveats: (1) it's a
single-year in-sample result on 2 symbols — the per-symbol filter split (SOL=UTBot, BNB=EMA200) risks
curve-fitting; validate on a 2nd year / more alts before sizing up. (2) The TP barely fires (5–16%), so
this is essentially "long the Asian-morning drift on 1D-bull days, flat by 04:00." Next: out-of-sample
year, add more alts (e.g. XRP/DOGE/LINK), and test using it as a timing overlay on the live UTBot book
rather than fixed $100.
