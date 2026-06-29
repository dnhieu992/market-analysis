# Accumulation-zone entry, spot, NO stop-loss — tracking-coins basket

**Date:** 2026-06-29
**Script:** `scripts/run-accumulation-no-sl-backtest.ts`
**Universe:** the 36 `/tracking-coins` symbols (prod DB), 34 had enough D1 history.
**Data:** Binance D1, 1460d (~4y), $1000/coin compounded, fee 0.05%/side.

## Strategy under test (user's real flow: spot, no SL)
- **Accumulation zone** = coin DOWN [ddMin,ddMax] from its peak **AND** in a tight sideways base
  (range ≤ rangeMaxPct over rangeLen) **AND** price in the lower part of the base (≤ low×(1+lowZone)) **AND** RSI ≤ rsiMax.
- **Entry:** buy LONG at close inside the base. **NO stop-loss.**
- **Exit:** price reclaims EMA34 (or EMA89) on close → sell all. Never reclaims → left OPEN, marked-to-market ("bag held").
- Tracks **MAE** (deepest drawdown while holding) — the real risk with no SL.

## Commands
```bash
... run-accumulation-no-sl-backtest.ts 1460 1000 0.05 0.6 0.8 30 0.25 0.08 45 34 0 365   # spec dd 60-80%, exit EMA34
... run-accumulation-no-sl-backtest.ts 1460 1000 0.05 0.4 0.7 30 0.25 0.08 45 34 0 365   # relaxed dd 40-70%, exit EMA34
... run-accumulation-no-sl-backtest.ts 1460 1000 0.05 0.4 0.7 30 0.25 0.08 45 89 0 365   # relaxed, exit EMA89
```

## Results (basket aggregate)
| config | camps | winRate | E[R]/camp | PF | still-open | avg MAE | worst MAE | avg$/coin |
|--------|------:|--------:|----------:|---:|-----------:|--------:|----------:|----------:|
| dd 60–80%, exit EMA34 | 73 | 68.5% | **−1.57%** | 0.72 | 12 | 12.0% | 99.98% | $940 |
| dd 40–70%, exit EMA34 | 134 | 67.2% | **−1.08%** | 0.81 | 11 | 12.8% | 99.98% | $920 |
| dd 40–70%, exit EMA89 | 97 | 60.8% | **−1.71%** | 0.79 | 12 | 17.7% | 99.98% | $917 |

### Per-coin (dd 40–70%, exit EMA34) — dispersion is the whole story
Winners: UNI +$325, AAVE +$218, ADA +$194, NEAR +$187, ZEC +$141, TAO +$106, INJ +$81, XLM +$36.
Losers: ATOM **−$617** (one campaign MAE 99.98%), SOL −$381, BCH −$377, LINK −$280, DOGE −$274, ETH −$226, HBAR −$217, ICP −$199.

## Takeaway
**Yes, you can enter from the accumulation zone — but on the full basket it is net-negative.**

- The exit-on-EMA34-reclaim gives a *high win rate (67–68%)* of small gains, which feels good, BUT with **no stop-loss the tail dominates**: ~11–12 campaigns get stuck underwater (marked-to-market open), and at least one coin (ATOM) ran an MAE of ~99.98%. Average E[R] is **negative** (PF 0.72–0.81) across every variant.
- The result is **almost entirely a function of WHICH coin**, not the entry timing — exactly the documented `/tracking-coins` DCA verdict (`2026-06-26-dca-dip-d1-no-sl`): no-SL DCA is fine on coins that survive and mean-revert, ruinous on coins that keep trending down / collapse.
- Relaxing dd 60–80% → 40–70% roughly doubles the trade count and slightly improves PF, but does not flip the sign.

**Conclusion for the page:** the accumulation-zone entry is sound *only* when gated by the survival filter the user already chose — `computeDcaScore` (market cap + weekly trend alive). The new strategy is best framed as a **refinement of the existing GOM zone**: add "deep drawdown from peak + tight sideways base" as a higher-quality accumulation trigger, but keep coin-selection (DCA score) as the no-SL defence. Without that filter it loses money.
