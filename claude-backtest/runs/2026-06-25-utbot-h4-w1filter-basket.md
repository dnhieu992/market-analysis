# UTBot H4 long-only spot + W1-bull filter — full top-cap basket

**Date:** 2026-06-25
**TF:** entries/exits on 4h, gated by the weekly (1w) UTBot trend · ATR(10) · up to 1500d
**Capital/Fee:** $1000 compounded, long-only spot, fee 0.05%/side · keyValue 2 fixed (best-kv ref only)

**Context:** The plain-H4 basket (`2026-06-25-utbot-spot-h4-basket.md`) whipsawed out of strong
uptrends and traded heavily in bear markets. Tested adding a filter: **only long while the weekly
UTBot trend is bull** (exit on H4 bear flip OR weekly turning bear).

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-utbot-h4-w1filter-backtest.ts "BTCUSDT,...,SEIUSDT" 1500 1000 0.05 "1,2,3,4"
```

## Aggregate vs plain H4 (kv2, 44 coins with adequate history)
| Metric | Plain H4 | **H4 + W1 filter** |
|---|---|---|
| Profitable (absolute) | 18/44 (41%) | **19/44 (43%)** |
| Beat Buy & Hold | 31/44 (70%) | **28/44 (64%)** |
| Median edge vs B&H | +24.4% | **+25.1%** |
| Avg win rate | ~37% | **33%** |
| Avg max drawdown | very high (ETH 57%, many 60–90%) | **49%** |
| Trade count | high (ETH 187) | **~half (ETH 99)** |

## What the filter changed
**Helped (calmer, kept aligned with weekly trend):**
- TRX +183% → **+328%**, DD 41% → **17%**  ·  LINK +28% → **+110%**  ·  SUI +8% → **+80%**
- ETH +112% → +94% but DD **57% → 30%**, trades 187 → 99  ·  DASH −33% → **+63%**  ·  SEI +39% → **+118%**
- ICP −48% → +22%  ·  APT −60% → +21%

**Hurt (filter chopped the home-run trends):**
- SOL **+633% → +49%**  ·  CAKE **+1,117% → +79%**  ·  XLM +314% → +7%  ·  PEPE +151% → **−81%**
- BNB +138% → +22%  ·  ZEC +158% → +112%  ·  BCH +34% → −31%

**Did NOT fix the worst case:** DEXE still −26% vs B&H +543% (edge −569%) — its weekly was bull, so
the filter let the H4 whipsaw through the whole uptrend anyway.

## Takeaway
The weekly filter is **a risk dial, not an edge upgrade**. The headline barely moved (median edge
+24% → +25%, profitable 41% → 43%) and it actually **beat buy & hold slightly less often (70% →
64%)**. What it genuinely did:

- **Cut drawdown and trade count roughly in half** (ETH 57%→30% DD, 187→99 trades) and kept the
  position aligned with the higher-timeframe trend — calmer, far better suited to low-touch spot
  "lướt". Coins that trend cleanly with the weekly (TRX, LINK, SUI, DASH) improved a lot.
- **At the cost of the moonshots** — SOL, CAKE, XLM, PEPE were the reason plain H4's median looked
  good, and the filter chopped them (delayed entry while weekly warmed, or forced exit on a weekly
  wobble). So average risk fell but so did peak upside; net expectancy ≈ unchanged.
- Still **low win rate (33%)**, still **~49% drawdowns**, still **param-fragile** (best-kv all over
  1–4), and the single worst whipsaw (DEXE) is untouched.

**Verdict:** Adding the W1 filter does **not** turn H4 into a reliable money-maker — it makes the
same modest, downside-skewed edge **less volatile and less work** (fewer trades, lower DD), while
sacrificing the rare huge trends. If trading H4 spot, the filtered version is the more *survivable*
choice; but for genuine conviction with minimal effort, plain **weekly UTBot** (kv1–2) is still the
cleanest fit — it captures the big trends (it doesn't gate itself out of them) with a higher win
rate and comparable drawdown. Bottom line across all tests: **use UTBot as a trend/risk tool on a
high timeframe; none of these beat simply riding the weekly trend, and the radar score remains
screening-only.**
