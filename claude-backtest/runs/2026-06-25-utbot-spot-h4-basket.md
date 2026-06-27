# UTBot long-only spot on H4 — full top-cap basket (50 coins)

**Date:** 2026-06-25
**TF:** 4h · ATR(10) · up to 1500d (Binance returns from listing for newer coins)
**Capital/Fee:** $1000 compounded, long-only spot, fee 0.05%/side
**Param:** keyValue **2 fixed** (chosen on ETH) = the honest out-of-sample test. A per-coin
"best kv" sweep (1–4) is shown for reference only (in-sample, not trustworthy).

**Context:** ETH H4 looked great (+113%). User asked whether it holds across the other coins in
the Top Cap Radar watchlist.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-utbot-spot-backtest.ts "BTCUSDT,ETHUSDT,...,SEIUSDT" 4h 1500 1000 0.05 "1,2,3,4"
```

## Aggregate (44 coins with adequate history; 6 thin samples excluded)
- **kv2 profitable (absolute): 18/44 (41%)**
- **kv2 beat Buy & Hold: 31/44 (70%)**
- **Median edge vs Buy & Hold: +24.4%**

## Standouts (kv2)
**Big winners:** CAKE +1,117% (B&H −71%), SOL +633% (B&H +28%), XLM +314% (B&H +37%),
TRX +183%, ZEC +158%, PEPE +151% (B&H −15%), BNB +138%, ETH +112% (B&H −21%).

**Best loss-mitigation (lost less than holding):** most alts that had brutal bear markets —
NEAR +11% vs B&H −69%, TAO +28% vs −61%, SEI +39% vs −70%, ALGO −18% vs −81%, ATOM −47% vs −85%.

**Underperformed Buy & Hold (whipsawed out of strong uptrends):** DEXE +0.4% vs B&H +543%
(edge −543%!), TRX (edge −152%), INJ (−123%), JST (−118%), XRP +5% vs +151% (−146%),
ZEC (−128%), BTC +59% vs +100% (−41%).

## Takeaway
The ETH result does **NOT generalize cleanly** — H4 UTBot long-only is mainly a **downside
shield, not a money printer**:

- It **beat buy & hold 70% of the time** (median +24%), almost entirely by **sitting in cash
  through the 2022→2024 alt bear market** — most of these alts dropped −60% to −94% on B&H, and
  the strategy cut those losses. That is real and valuable for a spot trader.
- But **only 41% were actually profitable**; the basket's headline is carried by a few big
  trend winners (CAKE, SOL, XLM). On a random alt you were more likely to still lose, just less
  than holding.
- It **underperforms buy & hold on coins in a strong secular uptrend** (DEXE, XRP, TRX, BTC,
  INJ, JST) — H4 is noisy, UTBot flips too often and gets shaken out of the move. The −543% edge
  on DEXE is the cautionary extreme.
- **Win rate is uniformly low (30–41%)** — a whipsaw-heavy trend-rider — and **max drawdowns run
  60–90%** on most alts. Slippage (unmodeled) bites harder on the less-liquid names.
- **Param fragility:** kv2 is rarely the per-coin optimum; "best kv" jumps between 1 and 4 with
  no stable pattern. A strategy that needs a different parameter per coin to shine is not a
  robust edge.

**Verdict:** Use H4 UTBot as a **risk-management / trend filter** (it keeps you out of bear
markets and beats holding most of the time), **not** as a standalone "this will be profitable"
signal — on most alts it still bled, just less. For cleaner, higher-conviction spot swings the
**weekly** UTBot (less noise, fewer whipsaws, higher win rate) remains the better fit; H4 suits
only active traders who accept low win-rate and deep drawdowns. Best practice if trading H4:
pair it with a higher-timeframe (D1/W1) bull filter to avoid the whipsaw underperformance, and
size down on illiquid names.
