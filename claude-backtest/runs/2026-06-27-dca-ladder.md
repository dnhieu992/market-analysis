# DCA Ladder backtest — BTCUSDT 1d

Backtest of the `/dca-ladder` page strategy, modeled faithfully against
`packages/core/src/analysis/dca-ladder.ts` + the worker `syncDaily()` fill/peak/TP logic.

> ⚠️ CONFIG CORRECTION: the LIVE config is the **DB schema default** (`schema.prisma`
> `DcaLadderSettings`): **firstTierPct 5, numTiers 10, stepPct 1.5, tpPct 10, feePct 0.05,
> enabled true**. The page's `FALLBACK_STATE` (10/5/5/10) is only used when the API is
> unreachable — an earlier version of this log mistakenly tested that. Results below use the
> real 10-tier config; the fallback 5-tier numbers are kept further down for reference.

## Strategy under test (LIVE config)
No-stop-loss tiered DCA. Track a running peak while FLAT; arm **10** buy-limit tiers at
**5 / 6.5 / 8 / 9.5 / 11 / 12.5 / 14 / 15.5 / 17 / 18.5% below the peak**, each deploying
`budget/10`. A daily low touching a tier fills it at the tier price; first fill → IN_POSITION
(peak frozen), TP armed at `avgCost × 1.10`. Deeper tiers keep filling on dips (avgCost blends
down). A daily high reaching TP sells 100%; realized PnL compounds into the next cycle's budget.
Fee 0.05%/side. Note: all 10 tiers sit within 18.5% of the peak, so a single ~19% dip fills the
**entire** budget — full deployment is easy and frequent.

## Commands
```bash
# LIVE config (10 tiers): days cap firstTierPct numTiers stepPct tpPct feePct
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-dca-ladder-backtest.ts 3200 1000 5 10 1.5 10 0.05
... scripts/run-dca-ladder-backtest.ts 365  1000 5 10 1.5 10 0.05
... scripts/run-dca-ladder-backtest.ts 1825 1000 5 10 1.5 10 0.05
```
New script: `scripts/run-dca-ladder-backtest.ts` (public Binance daily klines, no auth).

## Results — LIVE config (10 tiers, 5%/step 1.5%, TP+10)
| Window | Cycles | Win% | Realized | Open (unrealized) | Final equity | Total return | Max underwater | Time in market | Buy&Hold |
|--------|-------:|-----:|---------:|------------------:|-------------:|-------------:|---------------:|---------------:|---------:|
| Full (2017‑09 → 2026‑06, 3200d) | 53 | 100% | +$16,845 | **−$8,170** | $9,674 | **+867%** | −81.9% | 98.4% | **+1,495%** |
| 1825d (2021 top → now) | 27 | 100% | +$2,940 | **−$1,804** | $2,136 | **+114%** | −74.5% | 97.5% | +68% |
| 365d (last year) | 2 | 100% | +$60 | **−$485** | $575 | **−42.5%** | −45.8% | 95.3% | −43.8% |

At the window end the strategy sits in an **open, trapped cycle**: **10/10 tiers filled**,
avgCost ≈ $111,161, $17,845 deployed, mark ≈ $60,296 → **−45.8% underwater, open 261 days**,
no remaining tiers and no stop-loss.

### Reference — page FALLBACK config (5 tiers, 10/15/20/25/30, TP+10), API-down only
| Window | Cycles | Final equity | Total return | Buy&Hold |
|--------|-------:|-------------:|-------------:|---------:|
| Full 3200d | 65 | $14,830 | +1,383% | +1,494% |
| 1825d | 19 | $1,429 | +42.9% | — |
| 365d | 1 | $613 | −38.7% | — |

## Takeaway
The implementation is **faithful to the page logic** — tier math, fee handling, peak chasing,
and compounding all match the live code. But the **strategy is not "chuẩn" / safe**: the headline
"100% win rate" is pure **survivorship bias** — winners close at +10%, losers never close, they
just stay open and accumulate. On the **LIVE 10-tier config** across full history the strategy
books +867% final equity but **underperforms simple buy & hold (+1,495%)**, spending **98% of the
time in market** and enduring an **−82% max drawdown** on an open bag. In the last 365 days it is
**−42.5%** (≈ buy & hold −43.8%) because all 10 tiers filled into a sustained downtrend and capital
is now trapped with no exit rule. It does beat B&H in the 1825d window (+114% vs +68%) only because
that window starts at the unlucky 2021 top for B&H — regime-dependent, not a durable edge. The
10-tier ladder is in fact *more* trap-prone than the 5-tier fallback: all tiers sit within 18.5% of
the peak, so a single ~19% dip deploys the whole budget. The structural flaw is the missing stop /
invalidation: in a regime where price falls >19% below the peak and does not rebound +10% off the
blended avgCost, the cycle never closes and the whole budget is locked underwater indefinitely.
Recommend pairing the ladder with either a
cycle-invalidation rule (time/price stop), a coin-selection regime filter (only arm in confirmed
uptrends — cf. the tracking-coins dashboard approach), or position sizing that reserves dry powder
below the lowest tier.

## Reconciliation with the originating runs (this engine vs the prior DCA runs)
The page was built from the earlier DCA dip-bounce study (`2026-06-27-btc-dca-dip-bounce.md`,
`-configA-sweep.md`, `-oos-validation.md`). This run **confirms those numbers, not contradicts them**:

- On a **realized-PnL** basis my faithful engine reproduces their headline figures. The sweep's
  recommended config (−8/−13/−18/−23, TP+15) headlined ≈ **+2,549%**; my engine on the same config
  gives **realized +2,468%** — same ballpark, so the engine is consistent.
- The whole gap is the **open trapped bag**. The prior tables headlined realized / in-sample
  numbers; once the currently-open cycle is **marked to market** (−40%, 4–5 tiers filled into the
  2026 drawdown, no SL), final equity for *every* config falls **below buy & hold**:

  | Config (full history, MTM incl. open bag) | Realized | Open bag | Final equity | vs B&H +1,494% |
  |---|---:|---:|---:|---:|
  | **LIVE DB default 5%/10 tiers/1.5 step, TP+10** | +1,684% | −$8,170 | **+867%** | −628% |
  | Page FALLBACK −10/15/20/25/30, TP+10 (5 tiers) | +2,367% | −$9,842 | +1,383% | −111% |
  | Reco −8/13/18/23, TP+15 (4 tiers) | +2,468% | −$10,764 | +1,392% | −103% |
  | Reco −8/13/18/23, TP+30 | +2,151% | −$9,437 | +1,208% | −287% |
  | Shallow −5/9/13/17, TP+10 | +1,671% | −$8,182 | +853% | −641% |

- Two things worth flagging to the user: (1) **the LIVE DB-default config (5%/10 tiers/1.5 step,
  TP+10) is NOT the config the sweep recommended** (−8/13/18/23, TP+15, 4 tiers) — and it is the
  *worst* of the lot, the furthest below B&H; and (2) the originating
  study's **own final verdict was already negative** — `-oos-validation.md` concluded the strategy
  "does not survive honest out-of-sample testing… does not beat buy & hold," with only 1/20 top
  in-sample configs beating B&H out-of-sample. This run is consistent with that verdict.

---

## Follow-up: CYCLE-FAILURE rule (free the ladder, park the bag to HOLD)
User directive: don't care about the loss (a failed bag is absorbed into a long-term HOLD
strategy). Need a rule to declare a cycle **dead** so the ladder can reset and catch the next
bounce instead of staying trapped. Script: `scripts/run-dca-ladder-failrule-backtest.ts`.

**Model:** fixed notional $1000/cycle (no compounding, apples-to-apples). On failure → park
position to a separate HOLD bucket, start a fresh cycle (peak = current close). Wins summed as cash.

Rules tested: `time:<D>` (open ≥ D days), `dd:<X>` (low ≥ X% below avgCost), `tier:<Y>` (all tiers
filled AND low ≥ Y% below the lowest tier). LIVE 10-tier config, full history 2017→2026.

| Rule | Win cycles | Realized$ | Parked | Dead after | Hold MTM$ | Healed (median d) | Max stuck |
|---|--:|--:|--:|--:|--:|--:|--:|
| none (current) | 53 | 2,989 | 0 | – | – | – | **261d, open ∞** |
| time:90 | 119 | 5,803 | 13 | 90d | 41,585 | 11/13 (117) | 42d |
| dd:15 | 186 | 8,757 | 46 | 15d | 211,268 | 43/46 (117) | 9d |
| **dd:25** | **155** | **8,270** | **22** | **28d** | 100,197 | **20/22 (374)** | **42d** |
| dd:30 | 138 | 7,514 | 13 | 50d | 51,091 | 12/13 (451) | 59d |
| tier:5 | 192 | 8,946 | 63 | 11d | 296,006 | 60/63 (70) | 9d |

### Findings
1. **Any failure rule ~2–3× the realized output** vs the trapped baseline (53→119–198 win cycles,
   $2,989→$5.8–8.9k). Freeing capital so the ladder restarts is clearly worth it.
2. **Parking costs almost nothing under the user's plan.** ~90% of parked bags (20/22 for dd:25)
   later recover to +10% on their own — they heal in the HOLD bucket (median ~1yr) while the ladder
   keeps printing. So "give up the cycle" ≠ "lose the money"; it's just moving the bag to hold.
3. **Trade-off is aggressiveness vs hold-funding.** Aggressive (dd:15 / tier:2-5) maximise cycles
   but park 46–75 bags → you must fund a large, frequently-topped-up hold bucket. Moderate
   (dd:25–30) park only 13–22 bags, free the ladder within ~1–2 months, and keep ~85% of the cash.
4. **Price-based beats time-based.** `dd`/`tier` react to the actual move; `time` is arbitrary and
   can either cut a bag that's about to bounce or leave one stuck up to 270d.

### Recommendation
Define **cycle failure = daily price ≥ 25–30% below the blended avgCost** (`dd:25`–`dd:30`). Since
all 10 tiers fill within 18.5% of the peak, this means "price is ~35% below the cycle peak and the
ladder is exhausted" — a real bear, not a normal pullback. On trigger: move the bag to the hold
portfolio and arm a brand-new cycle at the current price. `dd:25` is the sweet spot: 155 win cycles
(+$8.3k cash on $1k notional), frees the ladder in ~28d (max 42d stuck vs ∞ today), and 20/22 parked
bags heal anyway. Equivalent tier form: declare dead when **all tiers filled AND price ≥ ~8–10%
below the lowest tier**.
