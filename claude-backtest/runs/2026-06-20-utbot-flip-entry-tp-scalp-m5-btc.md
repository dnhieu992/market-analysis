# UTBot Flip-Entry + Fixed TP scalp (M5) — BTCUSDT

**Date:** 2026-06-20
**Spec (user):** Follow UTBot on M5. On trend flip bear→bull enter LONG, bull→bear enter SHORT.
Fixed TP. Enter only at the flip (one position per break). Force close on the next trend flip.

## Rules
- UTBot Wilder ATR trailing stop, ATR period 10. trend = close > stop ? bull : bear (on close).
- Enter in the new trend direction at the flip candle's close (only at a flip).
- TP = tpPct from entry, checked intra-candle. Force close on the next flip (which also opens the opposite trade).
- If TP hits before the next flip → go flat and wait for next flip (no re-entry between).
- One position at a time, $1000 compounded, no leverage.

## Script
`scripts/run-utbot-flip-tp-scalp.ts` (new).
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-utbot-flip-tp-scalp.ts BTCUSDT 5m 90 1000 <fee> "1,2,3,4,5" <tpPct> 10
```

## Results — BTC M5, 90 days (2026-03-22 → 2026-06-20)

### TP = 0.5% (user's final spec)
**WITH real fee 0.05%/side**
| keyValue | trades | winRate | final$  | return% | maxDD% | TP/flip |
|----------|--------|---------|---------|---------|--------|---------|
| 1 | 3714 | 24.02% | $19.34  | -98.07 | 98.07 | 574/3139 |
| 2 | 1564 | 32.29% | $210.47 | -78.95 | 79.90 | 430/1133 |
| 3 | 824  | 38.96% | $444.50 | -55.55 | 56.51 | 303/520  |
| 4 | 528  | 43.94% | $585.08 | -41.49 | 41.49 | 228/299  |
| 5 | 367  | 47.96% | $623.93 | -37.61 | 39.66 | 175/191  |

**WITHOUT fee (raw edge)**
| keyValue | trades | winRate | final$    | return% | maxDD% |
|----------|--------|---------|-----------|---------|--------|
| 1 | 3714 | 35.95% | $795.25   | -20.47 | 23.29 |
| 2 | 1564 | 39.64% | $1,006.93 | +0.69  | 12.47 |
| 3 | 824  | 42.96% | $1,014.25 | +1.43  | 9.42  |
| 4 | 528  | 45.64% | $992.84   | -0.72  | 12.38 |
| 5 | 368  | 48.91% | $901.04   | -9.90  | 17.45 |

### TP = 0.3%  (best raw edge found)
**WITH real fee 0.05%/side**
| keyValue | trades | winRate | final$  | return% | maxDD% | TP/flip |
|----------|--------|---------|---------|---------|--------|---------|
| 1 | 3714 | 30.69% | $19.17  | -98.08 | 98.09 | 1059/2655 |
| 2 | 1564 | 41.69% | $174.14 | -82.59 | 83.01 | 648/916   |
| 3 | 824  | 54.98% | $490.35 | -50.96 | 51.74 | 452/372   |
| 4 | 528  | 58.14% | $583.64 | -41.64 | 42.10 | 307/221   |
| 5 | 368  | 65.22% | $702.29 | -29.77 | 30.47 | 240/127   |

**WITHOUT fee (raw edge)**
| keyValue | trades | winRate | final$    | return% | maxDD% |
|----------|--------|---------|-----------|---------|--------|
| 1 | 3714 | 39.61% | $788.15   | -21.19 | 22.23 |
| 2 | 1564 | 45.52% | $832.81   | -16.72 | 20.40 |
| 3 | 824  | 55.46% | **$1,118.15** | **+11.82** | 6.43 |
| 4 | 528  | 58.52% | $989.87   | -1.01  | 7.79  |
| 5 | 368  | 65.49% | $1,014.04 | +1.40  | 7.68  |

→ TP 0.3% is the first config with a **real raw edge** (kv=3: +11.82%, 55% win rate, only 6.4% DD).
But it still needs 824 trades → 82% fee drag at 0.05%/side. Break-even fee for kv=3 ≈ 11.82%/824 ≈
**0.0072%/side round-trip** — lower than typical maker fees (~0.02%/side), so even maker rebates
do NOT rescue it. The edge is real but too thin to survive any realistic fee.

### TP = 5% (first run, before correction) — for reference
TP 5% almost never triggers on M5 (0–5 TP hits across the whole period); it degenerates into pure
flip stop-and-reverse. WITH fee: -41% to -98%. WITHOUT fee best -4.4% (kv=3). Same shape.

## Takeaway
Raw edge (0% fee) is essentially **breakeven** — best +1.43% over 90 days at keyValue=3.
With the real **0.05%/side fee it collapses to -37% … -98%**: 367–3714 trades × 0.1% round-trip is
40%–370% of equity paid in fees. Higher keyValue (fewer flips) loses less only because it trades
less — not because the edge improves.

This is the **third** M5 scalp tested (after EMA ribbon 9/21/55 and 8/13/21) and the verdict is
identical: **on M5 BTC, taker fees dwarf any edge.** The TP value (0.5% vs 5%) only changes how the
exits split (TP vs flip), not the fee-driven outcome. Small accounts are not helped by M5 frequency.
For a UTBot flip approach that is actually profitable, use H4 (see the flip backtests in `runs/`),
where fewer trades keep fee drag manageable.
