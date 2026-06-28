# 2026-06-28 — DCA Ladder: first tier 5% vs 10% below peak

**Question:** keep everything in the LIVE config but move the **first tier** from **5% → 10%**
below the frozen peak. Does the deeper first entry help?

LIVE `DcaLadderSettings`: firstTierPct **5**, numTiers 10, stepPct 1.5, tpPct 10, feePct 0.05.
Tested change: firstTierPct **10** (rest unchanged). 10 tiers within 18.5% of peak (5%) vs within
23.5% of peak (10%).

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-dca-ladder-backtest.ts <days> 1000 <firstTierPct> 10 1.5 10 0.05
# current: firstTierPct=5   new: firstTierPct=10   windows: 3200 / 730 / 365
```

## Results

| Window | firstTier | Cycles | Realized | Final equity | Max UW | Open-cycle DD | Time in mkt |
|--------|-----------|-------:|---------:|-------------:|-------:|--------------:|------------:|
| 3200d  | **5%** (live) | 53 | +$16,845 | **$9,657 (+866%)** | −81.9% | −45.9% | 98.4% |
| 3200d  | 10%       | 46 | +$8,887 | $5,674 (+467%) | −80.3% | −42.6% | 88.6% |
| 730d   | **5%** (live) | 12 | +$812 | **$981 (−1.9%)** | −45.9% | −45.9% | 95.1% |
| 730d   | 10%       | 10 | +$662 | $954 (−4.6%) | −42.6% | −42.6% | 74.9% |
| 365d   | 5% (live) | 2 | +$60 | $574 (−42.6%) | −45.9% | −45.9% | 95.6% |
| 365d   | **10%**   | 1 | +$30 | **$591 (−40.9%)** | −42.6% | −42.6% | 83.8% |

Buy&hold same windows: +1545% / −1.3% / −44.5%. Both configs end holding the same trapped open
cycle (10/10 tiers filled, mark ~$60k, no SL).

## Takeaway

Moving the first tier 5% → 10% makes the ladder **more conservative but clearly lower-return**.
It waits for a deeper dip before the first fill, so it captures **fewer** dip-bounce cycles
(53→46 over full history) and compounds far less: realized **+866% → +467%** (roughly half),
final equity $9,657 → $5,674. The payoff is only a **small** risk reduction — max underwater
−81.9% → −80.3% and the open-cycle drawdown −45.9% → −42.6% (entries sit ~3% lower).

So the trade-off is bad on the bull/full history (give up ~half the return to shave ~1–3 pts of
drawdown) and only marginally positive in the deep-bear 365d window (−42.6% → −40.9%). The 5%
first tier keeps more capital working (98% vs 89% time in market) and wins clearly over long
horizons. **Recommendation: keep firstTierPct = 5%** unless the goal is explicitly fewer, deeper
entries. Settings change NOT applied to the live default — awaiting the user's call.
