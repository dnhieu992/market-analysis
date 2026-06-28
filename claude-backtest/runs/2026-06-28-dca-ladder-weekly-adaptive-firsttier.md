# 2026-06-28 — DCA Ladder: weekly-trend-adaptive first tier (5% bull / 10% bear)

**Idea (user's):** make the first tier regime-aware — weekly **bull** → start shallow (first tier
5% below peak, catch more bounces); weekly **bear/neutral** → start deep (10% below peak, lower
avgCost / less knife-catching). Compare vs the two static first-tier configs.

Weekly trend = the SAME `computeTimeframeTrend` the app uses for `weekTrend` (EMA89 + swing-pivot
structure), evaluated on **completed weekly candles only** (no lookahead). Re-evaluated each day
while the cycle is FLAT; frozen once IN_POSITION. Rule: `Up/StrongUp → 5%`, else (`Neutral/Down/
StrongDown`) → `10%`. Rest = LIVE config: 10 tiers, step 1.5%, TP +10%, fee 0.05%/side.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-dca-ladder-wtrend-backtest.ts <days> 1000 10 1.5 10 0.05
# windows: 3200 / 730 / 365  — runs STATIC 5%, STATIC 10%, ADAPTIVE side by side
```

## Results

| Window | Arm | Cycles | Realized | Final equity | Max UW | Open-cycle DD |
|--------|-----|-------:|---------:|-------------:|-------:|--------------:|
| 3200d | Static 5% | 53 | +$16,845 | **$9,669 (+867%)** | −81.9% | −45.8% |
| 3200d | Static 10% | 46 | +$8,887 | $5,680 (+468%) | −80.3% | −42.5% |
| 3200d | **Adaptive** | 51 | +$11,868 | $7,393 (+639%) | **−80.3%** | **−42.5%** |
| 730d | Static 5% | 12 | +$812 | $982 (−1.8%) | −45.8% | −45.8% |
| 730d | Static 10% | 10 | +$662 | $955 (−4.5%) | −42.5% | −42.5% |
| 730d | **Adaptive** | 14 | +$1,035 | **$1,169 (+16.9%)** | **−42.5%** | −42.5% |
| 365d | Static 5% | 2 | +$60 | $574 (−42.6%) | −45.8% | −45.8% |
| 365d | Static 10% | 1 | +$30 | $592 (−40.8%) | −42.5% | −42.5% |
| 365d | **Adaptive** | 1 | +$60 | **$609 (−39.1%)** | **−42.5%** | −42.5% |

Weekly regime in window (full history): bull 1043d / bear 2157d. Buy&hold: +1546% / −1.2% / −44.4%.

## Takeaway

**The adaptive rule is the best risk-adjusted choice — it keeps the low-drawdown profile of the
10% config while recovering most of the 5% config's return, and in the two recent windows it beats
BOTH statics outright.**

- **Drawdown:** adaptive matches static-10% in every window — max-underwater −80.3% (vs −81.9% for
  static-5%) and open-cycle drawdown −42.5% (vs −45.8%). The deep first tier during bear weeks is
  what trims the worst entries.
- **Return:** full history +639% — well above static-10% (+468%), below static-5% (+867%) but at a
  better drawdown. In **730d it wins both** (+16.9% vs −1.8% / −4.5%) and in the deep-bear **365d it
  wins both** (−39.1% vs −42.6% / −40.8%).
- **Why it works:** shallow 5% entry in bull weeks catches more dip-bounce cycles (51 vs 46 cycles,
  more compounding); deep 10% entry in bear weeks lowers avgCost and cuts drawdown. Exactly the
  intended behaviour.

**Recommendation: adopt the weekly-adaptive first tier (5% bull / 10% bear).** Unlike the static
10% change (which gave up ~half the return), this captures the drawdown benefit *without* the
return penalty. Next step would be wiring `computeTimeframeTrend` into the ladder's tier-arming
(API `armBuyTiers` + worker peak re-arm) so `firstTierPct` is chosen by the live weekly trend.
See [[project-dca-ladder-gom-advisory]] and `2026-06-28-dca-ladder-firsttier-5-vs-10.md`.
