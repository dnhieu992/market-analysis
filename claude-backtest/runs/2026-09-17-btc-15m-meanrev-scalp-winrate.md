# BTC 15m mean-reversion scalp — hunting win-rate > 50% (fees ignored)

**Goal:** user wants a fast capital-rotation scalp with **win rate > 50%**, explicitly
**ignoring trading fees**. Small account.

## Commands
```bash
# 1. Baseline fade (tight SL, TP=box middle) — LOW win rate
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-range-meanrev-btc-15m-backtest.ts 365 0

# 2. UTBot flip-entry + tiny 0.5% TP on 5m — still < 50%
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-utbot-flip-tp-scalp.ts BTCUSDT 5m 180 1000 0 "2,3,4" 0.5 10

# 3. Fade with WIDER stop (SL sweep 1.0/1.5/2.0 ATR) — raises win rate
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-range-meanrev-btc-15m-backtest.ts 365 0 5 24 0.8 15 <slAtr> 96 mid
```

## Config
BTCUSDT · 15m · 365d (2025-09-12 → 2026-09-17) · risk $5/trade · fee **0%/side** ·
Donchian(24) · minWidth 0.8% · RSI band ±15 · TP = box middle · time-stop 96 bars (24h).
Regime gate: ADX(14) < adxMax. Entry: fade band edge (`edge`) with RSI + candle-body confirm.

## Results (fees OFF)

UTBot flip + 0.5% TP (5m, 180d): best kv=3 → WR **42.4%** (+14% net but WR<50). Rejected.

15m fade, win rate vs stop width (≥20-trade rows):

| slAtr | adxMax | edge | trades | winRate | exp(R) | PF | net$ |
|------:|-------:|-----:|-------:|--------:|-------:|---:|-----:|
| 0.3 (default) | 25 | 0.15 | 109 | 28.4% | 0.097 | 1.14 | +53 |
| 1.5 | 22 | 0.15 | 53 | **50.9%** | 0.054 | 1.11 | +14.3 |
| 1.5 | 25 | 0.10 | 58 | 48.3% | 0.079 | 1.15 | +22.9 |
| 2.0 | 22 | 0.10 | 33 | **54.5%** | 0.066 | 1.15 | +10.9 |
| 2.0 | 22 | 0.15 | 53 | **54.7%** | 0.019 | 1.04 | +5.2 |
| 2.0 | 100 | 0.20 | 541 | 51.6% | -0.013 | 0.97 | **-36** |

## Takeaway
Win-rate > 50% **is** reachable, but only by widening the stop so a loss ≈ 2 wins
(mechanical, not a real edge): the fade needs **SL ≈ 2.0×ATR beyond the Donchian band,
TP = box middle, ADX(14) < 22, entry edge 0.10–0.15**. That yields **WR ≈ 54%** but just
**~33–53 trades/year** (≈1/week — NOT rapid-fire) and a **thin PF ~1.05–1.15**, so the
positive result is fragile on a 53-trade sample. Pushing frequency up (drop the ADX gate,
541 trades) drags WR to ~51% and expectancy **negative even before fees**. Critically,
the TP is only ~0.3–0.5%, so real fees (0.05%/side) eat 20–40% of each win and flip the
thin edge negative. Honest conclusion: no robust **high-frequency** WR>50% profitable
scalp exists in this data; the WR>50% configs are low-frequency and barely positive.

---

## Follow-up: accept WR~40%, rely on R:R > 1 (trend-pullback scalp)

User picked "real scalping frequency, use R:R>1 instead of win-rate."
EMA-ribbon (9/21/55) pullback scalp, BTCUSDT 5m, 180d, **fee 0%**, SL = pullback extreme
(max risk 1.5%), TP = rr×risk, trend-flip also closes.

```bash
scripts/run-ema-ribbon-pullback-scalp.ts BTCUSDT 5m 180 1000 0 "9,21,55" <rr> 0.05 1.5
```

| rr | trades | winRate | final$ | return% | maxDD% |
|---:|-------:|--------:|-------:|--------:|-------:|
| 1.5 | 2555 | 38.4% | 803.94 | **-19.6%** | 26.8 |
| 2.0 | 2183 | 32.7% | 897.40 | **-10.3%** | 23.5 |
| 2.5 | 1962 | 28.6% | 845.87 | **-15.4%** | 28.0 |
| 3.0 | 1810 | 25.0% | 742.86 | **-25.7%** | 34.5 |

**Every R:R is NET NEGATIVE even with zero fees.** At rr=2 breakeven WR=33.3%, actual
32.7% → the pullback entries have no edge; SL (pullback extreme) is hit by noise before
TP. Combined with the earlier tests this is conclusive for BTC:

- Mean-reversion fade: WR>50% only at ~1 trade/week, PF~1.1 (noise), negative after fees.
- UTBot flip + 0.5% TP (5m): +10–14% fees-off but ~1000–1700 trades/yr → ~100–170% equity
  lost to fees at 0.05%/side. Dead on arrival for a real account.
- EMA-ribbon pullback R:R scalp: negative at every R:R, fees off.

**Verdict:** BTC intraday scalping shows no positive expectancy in 180d–365d of data,
before fees. High frequency + fees makes it strictly worse. Recommend NOT scalping a
small account on BTC. Next levers to test if pursued: higher-volatility altcoins (bigger
range vs fee), or step up to 15m/30m trend R:R (fewer trades, fees survivable).
