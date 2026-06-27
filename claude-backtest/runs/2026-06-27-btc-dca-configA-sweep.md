# Config A DCA dip-bounce — parameter sweep + fill-model reality check

Goal (user): tune Config A (4 equal 25% tranches on drawdown tiers, sell all at +tp%) to find
optimal tier levels and TP on BTC spot 1d, 2017→now.

## Commands
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-dca-configA-sweep.ts BTCUSDT
```
Grid: start ∈ {5,7,8,10,12,15}, step ∈ {3,4,5,7,10}, tp ∈ {8,10,12,15,18,20,25,30} = 240 combos.
Tiers = start, start+step, start+2·step, start+3·step. Capital $1000, fee 0.05%/side.

## ⚠️ Fill-model matters more than the parameters
- **Optimistic model (intraday high/low triggers, same-candle round-trips allowed):** top combos
  showed absurd +20,000–30,000% with tp=8%. This is a backtest illusion — the engine "buys the
  day's low and sells the day's high in the same candle," and a tiny TP compounds that fantasy
  140+ times. NOT real.
- **Conservative model (all fills on CLOSE, no same-candle round-trip):** used for the real results
  below. This is the honest lower bound for a daily-bar strategy without intraday limit orders.

## Results — conservative model (top by robustness)
| Tiers | tp | Final | Return | Cycles | Max DD | MAR |
|---|---|---|---|---|---|---|
| −7/−11/−15/−19 | 30 | $8,293 | +729% | 10 | 81% | 9.0 |
| −5/−10/−15/−20 | 30 | $8,262 | +726% | 10 | 81% | 8.9 |
| −8/−13/−18/−23 | 30 | $8,726 | **+773%** | 11 | 81% | 9.5 |
| −10/−15/−20/−25 | 30 | $8,303 | +730% | 11 | 81% | 9.0 |
| −12/−15/−18/−21 | 30 | $8,526 | +753% | 9 | 81% | 9.3 |
| Original A (−10/15/20/25, tp 15) | 15 | $3,791 | +279% | 15 | 76% | 3.7 |
| **Buy & Hold (benchmark)** | – | $14,108 | **+1311%** | – | 83% | – |

## Findings
1. **TP wants to be HIGH (25–30%), not low.** Under realistic fills, small TPs just churn fees and
   sell winners early. Capturing the *real* recovery (≈+30%) is what pays — the exact opposite of
   what the optimistic model claimed. This is the single most important tuning result.
2. **Tier levels barely matter.** Any shallow-ish ladder (start −5…−12, step 3–5) lands in the same
   +600–770% band. The strategy is robust to tier placement; it is NOT robust to the fill model.
3. **Max drawdown stays ~81% no matter what.** Confirms again: this family cannot escape the bear
   drawdown — once fully deployed it holds through.
4. **Honest verdict: even the optimized version UNDERPERFORMS buy & hold** (+773% vs +1311%) with
   the *same* ~80% drawdown. The earlier apparent outperformance (+1860%) was entirely the
   optimistic-fill illusion. On a structurally-rising asset, complicating buy-and-hold with
   dip-timing mostly adds fee drag and cash-on-the-sidelines opportunity cost.

## UPDATE — re-run under the FAIR fill model (the correct one)
The conservative (close-only) model above was too pessimistic — it assumes you never use limit
orders. Re-ran the full 240-combo sweep under the FAIR model (intraday limit fills at the exact
tier/TP price, but no same-candle round-trip). Buy & Hold over the same window = +1311%.

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-dca-configA-sweep.ts BTCUSDT   # runDca now uses the FAIR model
```

### Top by return
| Tiers | tp | Final | Return | Cycles | Max DD | MAR |
|---|---|---|---|---|---|---|
| −12/−15/−18/−21 | 8 | $35,644 | **+3464%** | 85 | **73%** | 47.5 |
| −12/−16/−20/−24 | 8 | $30,067 | +2907% | 90 | 72% | 40.3 |
| −5/−9/−13/−17 | 10 | $27,568 | +2657% | 69 | 82% | 32.4 |

### Most robust (mean of tp-neighbourhood)
| Tiers | tp | Final | Return | Cycles | Max DD |
|---|---|---|---|---|---|
| −5/−9/−13/−17 | 8 | $26,748 | +2575% | 90 | 82% |
| −8/−13/−18/−23 | 15 | $26,486 | +2549% | 44 | 81% |
| −8/−13/−18/−23 | 30 | $24,696 | +2370% | 18 | 81% |
| Original A (−10/15/20/25, tp 15) | 15 | $16,518 | +1552% | 41 | 81% |

### Findings (FAIR model)
1. **Under realistic limit fills, essentially every sane config beats Buy & Hold** (+1311%). The
   dip-bounce edge IS real once fills are modelled correctly — the earlier "underperforms B&H"
   verdict was an artifact of the over-conservative close-only model.
2. **TP sweet spot is broad (8–30%).** Low TP (8) maximises raw return (+3464%) via many legit
   cycles, but means 85–90 round-trips → most exposed to real slippage/spread the model ignores.
   Higher TP (15–30) gives ~+2370–2550% with only 18–44 trades → far more robust to friction.
3. **Shallow tiers win** (start −5…−12, step 3–4). Deep ladders sit in cash too long.
4. **Max DD still ~73–82%** — the family never escapes the bear; the best-return config (−12/−15/
   −18/−21, tp8) even posts the *lowest* DD (73%) because it deploys a touch later.

## Recommendation (FAIR model)
- **Max return, accept many trades:** −12/−15/−18/−21, TP +8% → +3464%, maxDD 73%. Caveat: 85
  cycles ⇒ slippage-sensitive; real result lower.
- **Best balance (recommended):** **−8/−13/−18/−23, TP +15%** → +2549%, 44 trades, maxDD 81%.
  Robust across neighbours, moderate trade count, ~2× Buy & Hold.
- **Lowest execution risk:** −8/−13/−18/−23, TP +30% → +2370%, only 18 trades.
- All carry ~80% bear drawdown. To cut that you'd need partial-tranche sizing with deep-dip
  reserves or a regime overlay (note: naive 200-DMA stop backfired — see dip-bounce run).
