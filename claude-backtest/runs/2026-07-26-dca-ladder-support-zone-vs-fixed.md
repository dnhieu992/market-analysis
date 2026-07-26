# DCA ladder: hard support zones vs the fixed −15% step

**Date:** 2026-07-26
**Script:** `scripts/run-bottom-dca-zone-ladder-backtest.ts` (new — forked from `run-bottom-dca-x2x3-backtest.ts`)
**Goal (user):** the `/tracking-coins` DCA tab suggests the next add at a flat −15%. User asked whether
placing the ladder at **hard support zones** instead would be better.

## Setup
Strategy held at the **live** config, ladder placement is the ONLY variable: enter deep bottom
(dd 50–85% from 500d peak, base 30d ≤25%, price ≤ base-low+8%, RSI≤45), **3 equal-USD tranches**,
**full exit at x2**, no stop-loss, D1, 1460d, $1000/coin, fee 0.05%/side.

- `fixed` — shipped rule: tranche k fills at `firstEntry × (1 − 0.15k)`.
- `zone` — tranches fill at clustered pivot-low support below entry. Pivot lows over a 500d lookback
  (`pivotK` bars each side, only pivots confirmed before the entry bar — no lookahead), clustered
  within `zoneTolPct`, kept when they have ≥`minTouches` touches and sit within `maxDepthPct`, walked
  top-down with a `minGapPct` spacing floor. **Tranches the zones can't supply fall back to −15%.**

Two universes, as in the step sweep: **full basket** (36 symbols, 26 with campaigns) and the
**large-cap gate proxy** (20 majors, standing in for the live `dcaScore ≥ 50` gate).

```bash
BASE="1460 1000 0.05 0.5 0.85 30 0.25 0.08 45 500 3 0.15 2 2 1"
# fixed baseline
… scripts/run-bottom-dca-zone-ladder-backtest.ts $BASE fixed
# zone: [mode] [zoneLookback] [pivotK] [zoneTolPct] [minTouches] [minGapPct] [maxDepthPct]
… scripts/run-bottom-dca-zone-ladder-backtest.ts $BASE zone 500 3 0.03 2 0.08 0.6
BASKET="BTC,ETH,BNB,XRP,SOL,ADA,DOGE,LINK,BCH,LTC,AVAX,HBAR,SUI,UNI,AAVE,NEAR,ICP,XLM,ETC,ONDO" …
```

## Results

### Full basket — 39 campaigns
| ladder | winRate | E[R]/camp | PF | tiers filled | reached x2 | zone coverage |
|---|---|---|---|---|---|---|
| **fixed −15% (shipped)** | 53.8% | +7.81% | **1.62** | 2.1 / 3 | 15 | — |
| zone, gap ≥8% | 51.3% | **+8.71%** | 1.65 | 2.2 / 3 | 15 | 52.6% |
| zone, gap ≥15% | 51.3% | +5.49% | 1.45 | 2.0 / 3 | 15 | 34.6% |
| zone, gap ≥15%, ≥3 touches | 51.3% | +6.77% | 1.53 | 2.0 / 3 | 15 | 24.4% |
| zone, gap ≥15%, tol 2%, ≥3 touches | 51.3% | +5.92% | 1.47 | 2.0 / 3 | 15 | 19.2% |

### Large-cap gate proxy — 28 campaigns
| ladder | winRate | E[R]/camp | PF | zone coverage |
|---|---|---|---|---|
| **fixed −15% (shipped)** | 60.7% | +15.58% | **3.25** | — |
| zone, gap ≥8% | 57.1% | +16.19% | 3.21 | 57.1% |

### Where the zone variant's E[R] actually comes from (full basket, gap ≥8%)
| coin | fixed | zone | Δ |
|---|---|---|---|
| FIL | +134.49% | +167.82% | **+33.33** |
| BCH | +66.60% | +99.90% | **+33.30** |
| BNB | −2.23% | −1.41% | +0.82 |
| *9 coins* | — | — | 0.00 |
| ETH | +2.03% | −5.05% | −7.08 |
| TAO | −23.85% | −30.21% | −6.36 |
| INJ | −48.43% | −53.12% | −4.69 |
| AVAX / AAVE / HBAR / SHIB / LTC / ATOM / DOT / SOL / LINK / APT | — | — | −0.22 … −2.86 |
| **SUM Δ** | | | **+35.01** |

## Findings
1. **The gain is two coins.** FIL and BCH supply +66.6 of the +35.0 net Δ; every other coin is flat or
   negative. **15 of 26 coins are strictly worse** under zone placement, only 3 better. On the gate
   basket it is a single coin (BCH +33.3). This is the same outlier pattern that got −10% rejected in
   the 2026-07-12 step sweep, and it fails the same way: PF *drops* on the gate universe (3.21 vs 3.25)
   and win rate drops on both (−2.6pp / −3.6pp).
2. **Ladder placement never changes which campaigns win.** `reached x2 = 15` in **every single
   variant**, fixed or zone. The ladder only nudges average cost by a few percent; what decides a
   campaign is the entry gate and whether the coin recovers at all. This caps how much any placement
   rule can possibly be worth.
3. **The mechanism of the loss is nearest-support-is-too-near.** With `gap ≥8%` the zone rule often
   places tranche 2 shallower than −15%, deploying capital earlier into coins that keep falling —
   hence uniformly worse losers (HBAR −48.6→−50.8, INJ −48.4→−53.1, ETH +2.0→−5.1).
4. **Forcing zones deeper doesn't rescue it — it makes it worse.** Requiring ≥15% spacing drops E[R]
   to +5.49% (PF 1.45), below the fixed baseline. Tightening to "harder" support (≥3 touches, ±2% tol)
   only shrinks coverage to 19–24%, so the rule converges to the fixed ladder anyway while its rare
   zone placements land badly.
5. **Coverage confirms the structural objection.** Only **52.6%** of add-levels can be sourced from
   real support at the loosest setting, and **14 of 39 campaigns get no usable zone at all**. This
   universe is coins in 50–85% drawdown — they are frequently printing new lows, so there is often no
   support left below. Any shipped zone rule needs the fixed step as a fallback for roughly half the
   levels regardless.

## Recommendation
**Keep the fixed −15% ladder. Do not ship zone-based placement.** It is not merely neutral — it is
outlier-driven upside bought with uniformly worse losers, it loses on PF on the universe that matches
the live gate, and its stricter (more defensible) configurations are clearly worse than the baseline.
Finding 2 is the reason to stop looking here: the ladder rule cannot move outcomes, only average cost.

If the user still wants support levels in the DCA tab, ship them as **display-only context** — draw the
nearest 1–2 clustered pivot-low zones next to the −15% suggestion so the user can eyeball a manual
adjustment — without letting them drive the suggested ladder price. That captures the intuition
(FIL/BCH did fill better at real support) without the systematic cost on the losers.

## Related Files
- `scripts/run-bottom-dca-zone-ladder-backtest.ts` — this backtest; `ladderMode` = positional arg 16.
- `claude-backtest/runs/2026-07-12-bottom-dca-step-sweep.md` — the fixed-step sweep this extends.
- `packages/core/src/analysis/accumulation-signal.ts` — `dcaGomPlan`, the shipped −15% ×3 plan.
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts:412` — `nextAddPrice = lastBuy × 0.85`.
