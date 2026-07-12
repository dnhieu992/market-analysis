# Bottom-DCA ladder step-size sweep (−10 / −12 / −15 / −20%)

**Date:** 2026-07-12
**Script:** `scripts/run-bottom-dca-x2x3-backtest.ts`
**Goal (user):** confirm whether the fixed **−15%** ladder spacing shipped on `/tracking-coins`
(the "Vùng gom gợi ý" plan) is actually the best step, or just a reasonable default. The 2026-07-12
merged study (`2026-07-12-bottom-dca-x2x3-merged.md`) never swept the step — it only swept exit target
and entry depth. This run isolates the step.

## Setup
- Strategy held constant at the **live** config: enter deep bottom (dd 50–85% from 500d peak, base
  30d ≤25%, price ≤ base-low+8%, RSI≤45), **3 equal-USD tranches**, **full exit at x2** (no partial x3,
  no stop-loss), D1, 1460d, $1000/coin, fee 0.05%/side.
- Only the ladder step varies: `addStepPct ∈ {0.10, 0.12, 0.15, 0.20}` (each next tranche fills that %
  below the FIRST entry).
- Two universes: **full basket** (36 `/tracking-coins` symbols, 33 with data) and a **large-cap
  gate-proxy** (20 majors, simulating the live `dcaScore ≥ 50` survival gate).

```bash
# full basket, per step:
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-bottom-dca-x2x3-backtest.ts 1460 1000 0.05 0.5 0.85 30 0.25 0.08 45 500 3 <STEP> 2 2 1
# gate proxy: same, with
BASKET="BTC,ETH,BNB,XRP,SOL,ADA,DOGE,LINK,BCH,LTC,AVAX,HBAR,SUI,UNI,AAVE,NEAR,ICP,XLM,ETC,ONDO"
```
(`t1Mult=2 t2Mult=2 sellFrac=1` = clean all-out at x2; reproduces the merged study's PF ~1.58 at −15%.)

## Results

### Full basket (no gate) — 38 campaigns
| step | winRate | E[R]/camp | PF | avg tiers filled | worst MAE |
|---|---|---|---|---|---|
| **−10%** | 52.6% | **+11.30%** | 1.75 | 2.4 / 3 | 99.99% |
| −12% | 55.3% | +7.19% | 1.51 | 2.2 / 3 | 99.98% |
| −15% (shipped) | 50.0% | +7.55% | 1.56 | 2.1 / 3 | 99.98% |
| −20% | 50.0% | +7.70% | **1.64** | 2.0 / 3 | 99.98% |

### Large-cap gate proxy (live config) — 28 campaigns
| step | winRate | E[R]/camp | PF | avg tiers filled | worst MAE |
|---|---|---|---|---|---|
| **−10%** | 60.7% | **+19.48%** | 3.15 | 2.3 / 3 | 73.4% |
| −12% | 60.7% | +14.74% | 2.78 | 2.1 / 3 | 73.4% |
| −15% (shipped) | 57.1% | +15.06% | 2.99 | 2.0 / 3 | 75.2% |
| −20% | 57.1% | +14.49% | **3.32** | 1.8 / 3 | 75.2% |

## Findings
1. **The step is a capital-deployment / tail-risk dial, not a free-lunch optimum.** E[R] is essentially
   flat across −12/−15/−20 (~7% full, ~15% gate). Tighter step → more tranches fill (2.4 vs 2.0) →
   winners average down faster and reach x2 more often, but the coins that never recover accumulate a
   bigger bag. Wider step → less capital at risk, milder drawdowns, **highest PF**.
2. **−10%'s higher headline E[R] is NOT robust — it's one coin.** The +11.3%/+19.5% edge is almost
   entirely **XLM** (+233% at −10% vs +139% at −15% vs +106% at −20%; 3/3 campaigns hit x2 at −10%).
   Strip XLM and the edge collapses to the flat band. Meanwhile −10% makes **every loser strictly
   worse** — HBAR −53.6% vs −50.3% (−15%) vs −46.1% (−20%), SOL −34.2 vs −28.5 vs −23.4, LTC −31.0 vs
   −25.3 vs −19.6. So −10% buys an outlier-driven mean with uniformly fatter tails. Reject it.
3. **−20% is marginally the safest** — best PF on both universes (1.64 / 3.32), milder per-coin losses,
   fewer tiers deployed into dying bags — at the cost of slightly less averaging on the big winners
   (XLM/ICP score a bit lower).
4. **−15% is a defensible middle with no evidence to change it.** It sits mid-pack on every metric on
   both universes. The merged study's PF 1.58 at −15% reproduces here (1.56 full / 2.99 gate).

## Recommendation
**Keep the −15% ladder step on `/tracking-coins`.** It is not the mathematical optimum on any single
metric, but there is no robust reason to move: E[R] is flat across −12→−20, the only step that beats it
(−10%) does so via a single-coin outlier while worsening every loser, and the only step that's
arguably safer (−20%) trades away upside on the winners. If the user later prioritises **capital
efficiency / smaller drawdowns per campaign over raw expectancy**, −20% is the one to switch to — not
−10%. Continue to label the step a *suggestion* in the UI (it is a risk dial, not a swept optimum).

## Related Files
- `scripts/run-bottom-dca-x2x3-backtest.ts` — this backtest (`addStepPct` = positional arg 12).
- `claude-backtest/runs/2026-07-12-bottom-dca-x2x3-merged.md` — the merged strategy this step belongs to.
- `packages/core/src/analysis/accumulation-signal.ts` — `dcaGomPlan` (the shipped −15% ×3 plan).
