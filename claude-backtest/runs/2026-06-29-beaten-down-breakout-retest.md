# Beaten-down breakout-retest (user's 5-step strategy) — tracking-coins basket

**Date:** 2026-06-29
**Script:** `scripts/run-beaten-down-breakout-retest-backtest.ts`
**Universe:** the 36 `/tracking-coins` symbols (queried from prod DB), 34 had enough D1 history.
**Data:** Binance D1, 1460 days (~4y), $1000/coin compounded, fee 0.05%/side (0.1% round-trip).

## Strategy under test (the user's 5 steps)
1. Coin DOWN X% from its `peakLookback`-day peak **and** in a tight sideways base.
2. Volume confirmation (on-chain skipped for v1 — price+volume only).
3. Resistance = HIGH of the consolidation base.
4. Breakout: D1 close > resistance×(1+brkBuf) with volume > volMult×avgVol.
5. Entry: wait for a RETEST of the broken resistance, enter LONG there. SL below base low, TP = rr×risk.

## Commands
```bash
# spec as described (dd 60–80%)
... run-beaten-down-breakout-retest-backtest.ts                       # defaults: dd .6-.8, base30 ≤25%, vol1.8, retest8 ±1.5%, rr 1.5/2/3
# relaxed drawdown + looser retest
... run-beaten-down-breakout-retest-backtest.ts 1460 1000 0.05 0.4 0.7 20 0.18 1.5 0.005 12 0.02 "2,2.5,3,4" 365   # B1
... run-beaten-down-breakout-retest-backtest.ts 1460 1000 0.05 0.45 0.75 25 0.20 1.6 0.005 15 0.025 "2,3,4" 365    # B2
... run-beaten-down-breakout-retest-backtest.ts 1460 1000 0.05 0.4 0.7 20 0.18 2.0 0.005 12 0.02 "2,3,4" 365       # B3 (vol 2×)
... run-beaten-down-breakout-retest-backtest.ts 1460 1000 0.05 0.4 0.7 20 0.18 1.5 0.005 12 0.50 "2,3,4" 365       # B4 (no-retest control)
```

## Results

### Spec exactly as described — dd 60–80% (FAILS)
| rr | trades | winRate | E[R] | PF | avg$/coin |
|----|-------:|--------:|-----:|---:|----------:|
| 1.5 | 11 | 18.2% | **−8.62%** | 0.38 | $892 |
| 2   | 11 | 18.2% | −6.85% | 0.51 | $912 |
| 3   | 11 | 18.2% | −3.33% | 0.76 | $950 |

→ Too strict. 11 trades / 4y / 34 coins, all rr negative. These deep-drawdown bases are mostly falling knives whose breakouts fail and SLs (below a wide base) are large.

### Relaxed to dd 40–70% (modest positive edge)
| variant | rr | trades | winRate | E[R] | PF | avg$/coin |
|---------|---:|-------:|--------:|-----:|---:|----------:|
| B1 (vol1.5×, retest ±2%) | 2 | 31 | 38.7% | +1.47% | 1.18 | $1,026 |
| B1 | 3 | 30 | 33.3% | +3.34% | 1.37 | $1,062 |
| B1 | 4 | 30 | 33.3% | +7.46% | 1.83 | $1,141 |
| **B3 (vol2×, retest ±2%)** | 2 | 24 | 41.7% | +2.99% | 1.40 | $1,049 |
| **B3** | 3 | 23 | 34.8% | +4.41% | 1.53 | $1,070 |
| **B3** | 4 | 23 | 34.8% | +8.70% | 2.04 | $1,144 |
| B2 (dd .45–.75, vol1.6×) | 4 | 19 | 36.8% | +12.27% | 2.36 | $1,156 |
| **B4 (no-retest, enter at breakout close)** | 2 | 33 | 42.4% | +2.76% | 1.36 | $1,050 |
| **B4** | 3 | 32 | 37.5% | +5.27% | 1.63 | $1,097 |
| **B4** | 4 | 32 | 37.5% | +9.84% | 2.17 | $1,183 |

## Takeaway
The strategy has a **modest, real edge — but only after deviating from the exact spec**:

1. **The "60–80% from peak" band is the problem, not the engine.** As literally described it is net-negative (PF 0.38–0.76). Relaxing the drawdown to ~**40–70%** is what turns it positive.
2. **Step 5 (wait for retest) does NOT add edge.** The no-retest control (B4, enter at breakout close) beats the retest version on every metric — more trades, higher E[R], higher PF. The retest mainly *drops* trades whose pullback never comes.
3. **Let winners run.** rr 3–4 is materially better than 1.5–2 (these are recovery-momentum plays). Volume 2× (B3) improves trade quality over 1.5×.
4. **Low frequency / small sample.** Even relaxed, it's ~19–33 trades over 4 years across 34 coins. The edge is promising, not strongly validated; treat sizing conservatively.

Best balanced config: **dd 0.4–0.7, base 20d ≤18% wide, vol ≥2×, enter at breakout close (or retest ±2% within 12d), rr 3–4** → PF ~1.5–2.2, E[R] +4–10%/trade.
