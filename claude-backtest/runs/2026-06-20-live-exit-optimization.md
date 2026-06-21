# Exit optimization for the live swing pairs (4h/1d)

**Date:** 2026-06-20
**Script:** `scripts/run-flip-partial-atr-backtest.ts`
**Window:** 365 days · $1000 compounded · fee 0.05%/side · ATR(10)
**Context:** user wants to optimize EXITS (not entries). Builds on the M30 exit studies
(`2026-06-18-swing-partial-tp-breakeven-m30.md`, `2026-06-18-m30-atr-tp-sl-solution.md`), now run
on the actual live configs.

## Exit variant tested (the best from the M30 work)
Always-in-market; **bank half at +2.5×ATR(entry)**, runner keeps the UTBot line as trailing stop,
exits on the flip. **Breakeven stop OFF** (the M30 study proved breakeven re-entry = churn = worse).

## Results — baseline flip-only vs ATR-partial (no breakeven)

| coin | kv | BASELINE ret%/DD% | NEW ret%/DD% | WR base→new | verdict |
|------|---:|------------------:|-------------:|------------:|---------|
| ETHUSDT 4h | 2 | **+77% / 27%** | +52% / 28% | 41→46% | return −25%, DD ~same ❌ |
| BTCUSDT 1d | 2 | +19% / 15% | +15% / **10%** | 38→44% | ~wash, smoother |
| BNBUSDT 4h | 4 | +55% / 19% | +33% / **14%** | 43→**60%** | return −22%, DD better |
| SOLUSDT 1d | 2 | +69% / 22% | **+75% / 15%** | 53→**73%** | improves BOTH ✅ |

## Takeaway

Confirms the M30 lesson on the live pairs: **a partial-TP overlay is a risk-adjusted improvement,
not a raw-return improvement.** It lifts win rate everywhere (ETH 41→46, BNB 43→60, SOL 53→73) and
cuts drawdown ~25–30% on 3 of 4 (SOL 22→15, BNB 19→14, BTC 15→10) — but it **caps the big winners**,
so raw return falls ~20–25% on the strong trenders (ETH −25%, BNB −22%). SOL is the exception:
better on both axes. BTC is a wash (smoother).

Established by the broader exit work and unchanged here — things that HURT and should be avoided:
- **Breakeven stop + re-entry** → triples trades (churn), strictly worse return AND drawdown.
- **Hard early stop-loss** → smooth but unprofitable; removes the trend edge.
- **Small fixed TP (2–3%)** → halves return, adds whipsaw.
- **Fixed +5% partial** (currently shipped) → barely fires on these TFs; ATR-scaling is strictly better.

## Recommendation (depends on the goal)

- **Max raw $ return:** keep the current **flip-only** exit — it IS the return-maximizer. No exit
  tweak tested beats it on absolute return for the strong trenders.
- **Max risk-adjusted / fewer ugly drawdowns (likely what you want given the recent chop):**
  add **partial half at +2.5×ATR(entry), keep UTBot trail for the runner, NO breakeven.** Best fit
  for **BNB** (the chop-prone, add-on pair: WR 43→60, DD 19→14) and **SOL** (better on both). Leave
  **ETH** flip-only (the overlay only costs it return). I.e. apply the partial **selectively per coin**.
