# 2026-06-26 — Experiment #1: W1 (weekly) alignment filter on tracking-coin swing orders

## Idea
Order logic (`computeSwingLimitOrder`) only uses D1/H4 indicators. The scan already computes
**W1 trend + UT Bot W1** (shown on page) but never feeds them to the gate. Hypothesis: dropping
swing orders that fight the weekly bias improves expectancy and cuts drawdown.

## Implementation
Added experimental flag to the harness only (production core untouched):
`--w1=off|utbot|trend|both`. At each D1 close T it builds the W1 bias from weekly candles
closed by T (no lookahead), mirroring production: `calcUtBotResult(wCandles,10,2)` +
`computeTimeframeTrend`. Null/Neutral W1 does not block. File: `apps/worker/src/scripts/backtest-tracking-orders.ts`.

```bash
pnpm --filter worker backtest:orders -- --days=365 --symbols=BTC --w1=utbot
```

## Results

### BTC 365d
| w1 | filled | win% | E[R] | PF | MDD | removed |
|----|-------:|-----:|-----:|----:|-----:|--------:|
| off   | 171 | 43.9 | 0.148 | 1.42 | -13.5R | – |
| utbot | 115 | 52.0 | **0.321** | **2.03** | -11.0R | 68 |
| trend | 113 | 49.3 | 0.245 | 1.75 | -14.0R | 69 |
| both  | 101 | 52.3 | 0.303 | 1.99 | -11.0R | 87 |

### BTC 730d
| w1 | filled | win% | E[R] | PF | MDD |
|----|-------:|-----:|-----:|----:|-----:|
| off   | 350 | 35.2 | 0.006 | 1.01 | -32.5R |
| utbot | 212 | 35.3 | 0.016 | 1.04 | **-25.9R** |
| trend | 239 | 37.3 | 0.043 | 1.10 | -22.8R |
| both  | 172 | 35.4 | 0.007 | 1.02 | -21.6R |

### Basket BTC,ETH,BNB,SOL,XRP 365d (overfit guard)
| w1 | OVERALL E[R] | PF | win% | SHORT E[R] | LONG E[R] |
|----|-----:|----:|-----:|-----:|-----:|
| off   | 0.137 | 1.33 | 44.1 | 0.176 | 0.010 |
| utbot | **0.179** | **1.43** | 45.7 | 0.225 | 0.002 |
| trend | 0.125 | 1.29 | 43.2 | 0.180 | -0.037 |

## Takeaway
**`--w1=utbot` is the keeper.** It generalises: big lift on BTC-365d (E[R] 0.148→0.321, PF→2.0,
win crosses 50%), small lift + lower drawdown on BTC-730d, and a **consistent modest gain on the
basket** (E[R] +0.04, PF +0.10) — driven almost entirely by sharpening the SHORT book (the only
side with an edge). `--w1=trend` helps BTC but **hurts the basket** → unreliable, discard.

Two honest caveats:
1. The dramatic BTC-365d numbers are partly the same recency we flagged earlier; the basket shows
   the real effect size is modest, and the 730d window is still ~break-even. W1 reduces bad trades
   and drawdown more than it manufactures a strong edge.
2. **LONG stays weak/negative everywhere even after W1** (basket LONG E[R] ≈ 0). Confirms
   experiment #2 (fix/drop the LONG side) is still the bigger lever.

Next: combine `--w1=utbot` with a LONG-side fix and re-test on the basket before touching prod.
Results are gross of fees (limit fills).
