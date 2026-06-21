# Breakeven SL, threshold split by timeframe (H4 +3% / 1D +5%)

**Date:** 2026-06-20
**Script:** `scripts/run-breakeven-tf-split-backtest.ts`
**Window:** 365 days · $1000/leg FLAT (no compounding) · fee 0.05%/side · ATR(10)
**Context:** user asked to test "kéo SL về entry" (move stop to breakeven) with **different arming
thresholds per TF**: H4 legs arm at **+3%**, 1D legs at **+5%**. Builds on the live pairs of
`2026-06-20-live-exit-optimization.md`.

## Rule tested
Always-in-market UTBot stop-and-reverse. Once a leg is up the per-TF threshold, move its SL to
entry and keep riding to the flip. If price later retraces to entry, the leg closes at breakeven
(≈$0, minus fees) instead of riding the flip down. Applied to every leg (base + BNB pullback adds).
`be` = legs stopped out at breakeven. Arm-then-stop ordering (a leg armed on candle i can only be
BE-stopped on i+1) to avoid same-candle whipsaw.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-breakeven-tf-split-backtest.ts 365 0.05 1000 3 5
```

## Results — CURRENT (ride flip) vs NEW (BE split TF)

| coin | kv | BE@ | CURRENT net | NEW net | WR cur→new | be | Δ net |
|------|---:|----:|------------:|--------:|-----------:|---:|------:|
| ETHUSDT 4h | 2 | +3% | +$780.00 | **+$941.38** | 43→58% | 18 | **+$161** ✅ |
| BTCUSDT 1d | 2 | +5% | +$223.33 | +$99.23 | 38→44% | 2 | −$124 ❌ |
| BNBUSDT 4h | 4 | +3% | +$1,596.21 | +$791.22 | 35→44% | 12 | **−$805** ❌ |
| SOLUSDT 1d | 2 | +5% | +$678.39 | +$356.41 | 53→80% | 8 | −$322 ❌ |
| **TOTAL** | | | **+$3,277.92** | **+$2,188.23** | 40→54% | 40 | **−$1,089.69 (−33%)** |

## Takeaway

Same pattern as every prior breakeven study: **win rate jumps (81→102 wins, 40→54%) but net return
falls hard (−$1,090, −33%).** Moving the stop to entry chops trades off at $0 right before the trend
resumes — it converts would-be big winners into scratches. The effect is worst on the strong/choppy
trenders: **BNB −$805** (the BE stop kills pullback add-on legs that the flip would have ridden to a
much bigger gain — exactly the legs that make BNB the top earner) and **SOL −$322** (WR 53→80% but
gross profit halved). **BTC −$124.** **ETH is the only winner (+$161)** because its 4h chop generated
many would-be losers that BE rescued (loss legs 52→38).

**Verdict: net-negative overall — do NOT ship as a blanket rule.** It is a risk-adjuster, not a
return-improver. If applied at all, apply **ETH-only** (the one pair it helps), and explicitly keep
**BNB on ride-to-flip** since BE is most destructive there. This is consistent with the earlier exit
work: breakeven/early stops smooth the equity curve but remove the trend edge.
