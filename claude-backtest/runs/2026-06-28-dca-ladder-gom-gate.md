# 2026-06-28 — DCA Ladder: GOM-zone entry gate (tracking-coins signal) A/B

**Question:** I added the `/tracking-coins` DCA signal (zone GOM/CHO/CHOT + safety score)
to the `/dca-ladder` page. Does using the **GOM zone as a hard cycle-START gate** improve the
BTC ladder vs. the current always-armed baseline? (i.e. is GOM a good "điểm bắt đầu DCA"?)

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-dca-ladder-gom-backtest.ts <days> 1000 10 5 5 10 0.05
# windows: 3200 (full history), 730, 365
```

Script: `scripts/run-dca-ladder-gom-backtest.ts`. Reuses the **shipped** logic —
`calculateEma`, `calculateRsi`, `dcaZone` from `@app/core` (exactly what `computeDcaTimingSignal`
calls). Both arms share window/seed/params; the only difference is the entry gate.

- **Baseline** = `run-dca-ladder-backtest.ts`: while FLAT the peak chases highs and 5 tiers
  (10/15/20/25/30% below peak) are always armed; a daily low touching a tier fills it; TP +10%.
- **GOM-gated** = identical, but a FLAT cycle arms NO tier until the D1 zone first hits **GOM**
  (below EMA34 **and** RSI(14) ≤ 35 **and** within 8% of the 20-day low). Peak still chases highs
  while waiting; on the GOM bar it freezes and tiers arm.

## Config
BTCUSDT 1d · $1000 compounding · tiers 10/15/20/25/30% below peak · TP +10% · fee 0.05%/side.

## Results

| Window | Arm | Cycles | Realized | Final equity | Max UW | Idle (GOM wait) |
|--------|-----|-------:|---------:|-------------:|-------:|----------------:|
| 3200d (2017-09→2026-06) | Baseline | **65** (100% win) | +$23,673 | **$14,771 (+1377%)** | −71.8% | — |
| 3200d | GOM-gated | 10 (100% win) | +$1,227 | $1,333 (+33%) | −79.9% | 896 d |
| 730d (2024-06→2026-06) | Baseline | 10 | +$557 | **$933 (−6.7%)** | −40.1% | — |
| 730d | GOM-gated | 4 | +$357 | $813 (−18.7%) | −40.1% | 400 d |
| 365d (2025-06→2026-06) | Baseline | 1 | +$20 | **$611 (−38.9%)** | −40.1% | — |
| 365d | GOM-gated | 0 | $0 | $599 (−40.1%) | −40.1% | 128 d |

Buy&hold over the same windows: +1540% / −1.5% / −44.6%.
Both arms end the window holding the **same** underwater open cycle (avgCost ~$100k, mark ~$60k,
−40%) — neither escapes it (no stop-loss).

## Takeaway

**Hard-gating the BTC ladder's cycle-start on the GOM zone HURTS in every window** — fewer cycles
(65→10 over full history), far less compounding (+1377% → +33%), and it does **not** reduce
drawdown (max-underwater is equal or worse, −71.8% → −79.9%). The reason: GOM (RSI ≤ 35 **and**
within 8% of the 20-day low) is rare on BTC daily, so the ladder sits idle for hundreds of days
(896 over full history) and misses the frequent shallow dip-bounce cycles that drive the ladder's
edge. The GOM zone was designed for **alt-coin selection / no-SL survival** on `/tracking-coins`,
not for timing BTC ladder entries.

**Decision: keep the signal ADVISORY (as shipped) — do NOT wire it as a cycle-start gate.** The
panel informs the user ("now is/ isn't an oversold moment + how safe the weekly structure is")
while the mechanical always-armed ladder keeps capturing dip-bounces. This backtest is what
validates leaving ladder mechanics untouched. See [[project-tracking-coins-entry-score]] and the
DCA-no-SL findings in `2026-06-26-*`.
