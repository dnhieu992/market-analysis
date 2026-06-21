# M30 UTBot split-entry (BTC) — bull→long@00:00, bear→short@02:00

**Date:** 2026-06-20
**Script:** `scripts/run-m30-utbot-split-entry-backtest.ts`
**Window:** 365 days · `30m` · $1000 fixed/trade · fee 0.05%/side · UTBot ATR(10) · TP 0.75% · exit 08:00
**Context:** user idea — decide direction from M30 UTBot at 00:00; **longs enter at 00:00**, but
**shorts are delayed to 02:00** (to skip the early Asian up-drift that hurts shorts). BTC only.

## Command
```bash
SYMBOLS=BTCUSDT … run-m30-utbot-split-entry-backtest.ts 365 0.05 1000 0.75 8 <kv> 10 2
```

## Results (BTC)

| kv | TP hit | WR | GROSS | NET | long NET | short NET |
|---:|------:|----:|------:|----:|---------:|----------:|
| 1 | 123 | 58.6% | +$164.16 | −$200.92 | −$153.62 | −$47.29 |
| 2 | 115 | 51.5% | −$91.72 | −$456.54 | −$231.95 | −$224.58 |
| 3 | 124 | 53.7% | −$14.08 | −$378.97 | −$190.75 | −$188.22 |

## Takeaway

**Delaying shorts to 02:00 genuinely helps.** At kv=1 gross rises to **+$164** (vs +$110 when shorts
also entered at 00:00) because the short leg avoids the 00:00→02:00 up-drift. The leg split shows it
clearly: **short net −$47** (gross ≈ +$133 after adding back ~$180 fees) is now the bigger positive
contributor, while the **long net −$153** (gross only ≈ +$32) is the weak leg.

**Still net-negative — the fee wall.** Best gross +$164 / 365 / $1000 = **0.045%/trade**, below the
0.1% round-trip fee → net −$201. That said, this is **the best BTC config of the whole study** (−$201
vs −$255 prior). kv=2/3 have negative gross (worse direction selection) — only kv=1 is interesting.

**Conclusion unchanged:** the split-entry is a smart refinement that lifts gross to ~0.045%/trade but
still doesn't clear the 0.1% fee. BTC needs lower fees (maker ~0.02%/side flips +$164 net-positive) or
fewer trades. The long leg is the drag — worth testing a **short-leg-only** variant (gross ≈ +$133) to
see if the short side alone gets closer to breakeven.
