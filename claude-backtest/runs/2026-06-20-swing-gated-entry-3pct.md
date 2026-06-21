# Swing flip — base-entry gate (only enter immediately if <3% from UTBot line)

**Date:** 2026-06-20
**Script:** `scripts/run-flip-gated-entry-backtest.ts` (new)
**Window:** 365 days (2025-06-20 → 2026-06-20), public Binance klines
**Sizing:** flat $100/leg, no compounding · fee 0.05%/side · ATR(10)

## Rule under test

Requested change to the live swing-trading page strategy (UTBot stop-and-reverse on close):

- **CURRENT (live):** on every confirmed flip, enter the base immediately at the close.
- **NEW:** on a flip, only enter immediately if `dist% = |close-line|/line < 3%`. If the entry
  is ≥3% from the UTBot line, **do not enter immediately** — wait for the first candle whose
  close pulls back within the **1%** band and enter the base there. If the trend flips again
  before that, the leg is **abandoned** (flat for that leg).
- **Pullback scale-in add-on:** unchanged (band 1%, maxAdds 3; production-gated to kv=4 → only BNB).

> Key mechanic: at a flip the new UTBot stop sits exactly `nLoss = keyValue×ATR` from the close,
> so the entry's distance from the line **at a flip is always `keyValue×ATR/close`**. The 3% gate
> is therefore a volatility filter: it only lets a flip enter immediately when `keyValue×ATR/price < 3%`.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-gated-entry-backtest.ts 365 0.05 3 1 3 100
```

## Results — gate 3% (the requested rule)

| Config            | CURRENT net | NEW net | Δ | flips: immediate / far→filled / abandoned |
|-------------------|------------:|--------:|------:|---|
| ETHUSDT 4h kv=2   | $77.61 | $55.45 | **-22.16** | 22 imm / 43 filled / 25 abandoned (of 91) |
| BTCUSDT 1d kv=2   | $22.51 | -$10.86 | **-33.36** | 0 imm / 7 filled / 8 abandoned (of 16) |
| BNBUSDT 4h kv=4   | $168.19 | $98.08 | **-70.11** | 0 imm / 24 filled / 4 abandoned (of 29) |
| SOLUSDT 1d kv=2   | $68.40 | $1.29 | **-67.11** | 0 imm / 3 filled / 11 abandoned (of 15) |
| **Total**         | **$336.71** | **$143.96** | **-$192.75** | |

NEW is net-negative on **all four** live pairs and also lowers win rate.

## Sensitivity (gate 5% / 8%, band 1%) — Δ vs CURRENT

| Config          | gate 3% | gate 5% | gate 8% |
|-----------------|--------:|--------:|--------:|
| ETHUSDT 4h kv=2 | -22.16 | +1.25 | +2.74 |
| BTCUSDT 1d kv=2 | -33.36 | -47.55 | +5.26 |
| BNBUSDT 4h kv=4 | -70.11 | -91.13 | +7.17 |
| SOLUSDT 1d kv=2 | -67.11 | -67.11 | -47.08 |

The gate only stops hurting once it is so wide (≈8%) that it barely ever fires — i.e. it
converges back to CURRENT. No tested threshold is a clear improvement.

## Follow-up: widen the delayed-entry (pullback fill) band to 2% / 3%

Same 3% immediate-entry gate, but a far flip now fills the base anywhere within 2% (then 3%) of
the line instead of 1%. Scale-in add-on band stays 1%. Goal: turn *abandoned* legs into *delayed*
ones. Command: `... run-flip-gated-entry-backtest.ts 365 0.05 3 <fillBand> 1 3 100`.

| Config          | Δ fill≤1% | Δ fill≤2% | Δ fill≤3% |
|-----------------|----------:|----------:|----------:|
| ETHUSDT 4h kv=2 | -22.16 | -27.37 | -8.91 |
| BTCUSDT 1d kv=2 | -33.36 | -20.87 | **+14.25** |
| BNBUSDT 4h kv=4 | -70.11 | -19.55 | -29.46 |
| SOLUSDT 1d kv=2 | -67.11 | -53.95 | -37.90 |
| **Total Δ**     | **-192.75** | **-121.74** | **-62.02** |

Widening the fill band does cut abandonment (e.g. BTC 1d 8→0, BNB 4→0 at ≤3%) and shrinks the
loss, but the strategy stays **net-negative on 3 of 4 pairs** and **-$62 overall**. Only BTC 1d
turns slightly positive. Win rates still fall (SOL 53%→18%, ETH 41%→37%): the delayed fill
suffers **adverse selection** — the strongest trending legs run away from the line and never
pull back, so they fill late/small or not at all, while the choppy legs that *do* retrace get
full size. The closer the fill band gets to "always fill", the closer the result converges to
CURRENT — i.e. the best version of the rule is to not have it.

## Follow-up 2: raise the gate to 5% (× fill band 1/2/3%)

Δ vs CURRENT (net PnL, $100/leg flat):

| Config          | g5 fill1% | g5 fill2% | g5 fill3% |
|-----------------|----------:|----------:|----------:|
| ETHUSDT 4h kv=2 | +0.97 | +8.63 | **+14.02** |
| BTCUSDT 1d kv=2 | -47.23 | -21.42 | **+18.62** |
| BNBUSDT 4h kv=4 | -85.62 | -34.04 | -30.12 |
| SOLUSDT 1d kv=2 | -66.49 | -53.57 | -37.51 |
| **Total Δ**     | **-198.37** | **-100.40** | **-34.99** |

Gate-total comparison (lower magnitude = closer to CURRENT):

| gate | fill 1% | fill 2% | fill 3% |
|------|--------:|--------:|--------:|
| 3%   | -192.75 | -121.74 | -62.02 |
| 5%   | -198.37 | -100.40 | **-34.99** |

Raising 3%→5% only helps **once paired with a wide fill band**. The best gate config found is
**gate 5% + fill ≤3%** at **-$35 total** — still a net loss, but ETH (+14) and BTC 1d (+18.6)
turn positive there. The drag is structural and stays on **BNB (kv=4)** and **SOL (1d)**, which
no gate threshold fixes: BNB is the strongest trender ($160/yr) so any entry delay sacrifices a
lot; SOL daily has 0 immediate entries (every flip ≥5% from line) and abandons legs. A distance
gate cannot separate "extended but about to run" from "extended and about to whipsaw".

## Takeaway

The 3% gate is **net-negative across every live config** (-$193 total on flat $100/leg). The
damage comes from **abandoned legs**: on daily timeframes and on BNB kv=4, `keyValue×ATR/price`
is almost always ≥3%, so essentially **no** flip qualifies for an immediate entry, and the
strategy is forced to wait for a 1%-band pullback that frequently never arrives before the next
flip (SOL 1d abandoned 11/15, BTC 1d 8/16). Missing those entries means missing the trending
legs that carry the whole strategy — the UTBot flip edge is "always in market", and gating the
entry breaks that. **Recommendation: do not ship the 3% entry gate.** If a "don't chase extended
entries" rule is still wanted, the lever to test next is a **wider/looser delayed-entry band**
(e.g. fill the pending base anywhere within 2–3% of the line instead of 1%) so far flips are
delayed rather than abandoned — but as-is, immediate entry on every flip remains best.
