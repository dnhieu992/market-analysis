# BTC DCA dip-bounce — out-of-sample validation + slippage (the honest verdict)

Optimize on IN-SAMPLE 2017-08-17..2022-12-31, then test the chosen params on UNSEEN
OUT-OF-SAMPLE 2023-01-01..2026-06-27. FAIR fill model, fresh $1000 per segment, fee 0.05%/side,
slippage 0.05%/side (configurable).

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-dca-oos.ts BTCUSDT
```

## Benchmarks
| | IS (2017–2022) | OOS (2023–2026) |
|---|---|---|
| Buy & Hold | +286% (maxDD 83%) | **+263%** (maxDD 52%) |

## IS winners → how they did OOS (edge vs OOS Buy & Hold)
| Tiers | tp | IS ret | OOS ret | OOS DD | vs B&H |
|---|---|---|---|---|---|
| −12/−19/−26/−33 (IS-chosen) | 8 | +507% | **+21%** | 35% | **−242%** |
| −8/−13/−18/−23 | 30 | +500% | +85% | 44% | −178% |
| −5/−9/−13/−17 | 18 | +378% | +239% | 44% | −24% |
| −5/−8/−11/−14 | 18 | +442% | +256% | 50% | −7% |

## ❌ The strategy FAILS out-of-sample
- The config picked as best on 2017–2022 (−12/−19/−26/−33, tp+8) returned **+507% IS but only
  +21% OOS**, while simply holding BTC returned **+263%** over the same OOS window. Edge −242%.
- **Only 1/20 of the top in-sample configs beat Buy & Hold out-of-sample.** The in-sample ranking
  did not transfer — classic overfitting.
- Hindsight-best OOS config (−5/−9/−13/−17, tp+10) made +375%, but it was *not* selectable from the
  IS data. You can only know it after the fact.

## Why it breaks
Regime change. 2017–2022 had violent crashes + huge V-recoveries (IS B&H maxDD 83%) — perfect for a
dip-bounce mechanic. 2023–2026 was a steadier grind up (OOS B&H maxDD only 52%). In a calmer bull:
(a) deeper-tier configs barely trigger → sit in cash → miss the rally (+21%); (b) the "sell the
bounce" rule keeps getting left behind. The edge lives almost entirely in high-volatility crash
events, which don't repeat on schedule.

## Slippage sensitivity (OOS return %)
| Config | 0.00% | 0.05% | 0.10% | 0.20% | 0.50% | cycles |
|---|---|---|---|---|---|---|
| chosen tp8 | +21 | +21 | +20 | +19 | +16 | 19 |
| lowTP tp10 (hindsight) | +393 | +375 | +337 | +307 | +209 | 44 |
| Buy & Hold | +263 | +263 | +263 | +263 | +262 | 1 |

High-frequency (44-cycle) configs bleed badly to slippage (+393→+209 at 0.5%/side); Buy & Hold is
essentially immune (1 trade). This compounds the problem for the dip-bounce family.

## FINAL VERDICT
The DCA dip-bounce strategy does **not survive honest out-of-sample testing**. The strong full-
history numbers (+2370–3464%) were in-sample overfitting. Forward-tested on an unseen regime, the
IS-optimal config (+21%) lost badly to plain Buy & Hold (+263%), and 19/20 top IS configs failed to
beat B&H OOS. For BTC, **simple buy & hold (or periodic DCA + hold) remains the honest baseline to
beat** — and this mechanic does not beat it out-of-sample. If pursuing the idea further: test on
mean-reverting/ranging assets, use walk-forward (not single-split) validation, and keep TP high to
limit slippage drag.
