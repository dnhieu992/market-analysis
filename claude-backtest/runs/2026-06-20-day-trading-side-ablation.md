# Backtest — `/day-trading` side ablation (disable / halve LONG)

**Date:** 2026-06-20
**Symbol:** BTCUSDT (Bitget USDT-M futures)
**Question:** The live strategy's LONG book is a net loser (see
`2026-06-20-day-trading-live-strategy.md`). Does disabling or down-sizing LONG help?

## Harness change

Added a `--side=both|long|short` flag to `apps/worker/src/scripts/backtest-day-trading.ts`.
A filtered-out direction is treated as **no-signal**, so the single-position slot stays
free for the allowed side (faithful — a skipped LONG no longer blocks subsequent SHORTs;
this is NOT a post-hoc row delete). The half-size-LONG variant is computed from the
"both" run's time-ordered trade series by scaling each LONG's netR by 0.5 (LONG still
occupies the slot, just bets half R), validated against the reported both-run numbers.

## Commands

```bash
# short-only, faithful slot model
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- --days=90 --side=short
# both (baseline) + CSV for the half-LONG blend
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- --days=90 --csv=/tmp/dt90.csv
```

Config: 15m/1H/4H, minRR 2, stop 0.50%, risk $2, fee 0.06%/side, expiry 192 bars,
single-position, SL-first tie, static management (production defaults).

## Results (net of fees, risk $2/trade)

| Window | Variant | net USD | Max DD | PF |
|--------|---------|--------:|-------:|----:|
| 60d  | Both (live)     | +32.9 | −6.9R  | 1.49 |
| 60d  | LONG half-size  | +32.9 | −6.7R  | —    |
| 60d  | **Short-only**  | **+46.6** | **−6.7R** | **2.20** |
| 90d  | Both (live)     | +19.6 | −17.9R | 1.18 |
| 90d  | LONG half-size  | +24.3 | −13.7R | —    |
| 90d  | **Short-only**  | **+52.4** | **−6.7R** | **1.87** |
| 180d | Both (live)     | +13.8 | −17.9R | 1.06 |
| 180d | LONG half-size  | +18.7 | −15.2R | —    |
| 180d | **Short-only**  | **+43.2** | **−14.0R** | **1.27** |

Short-only also fires more SHORTs (180d: 124 → 130) and lifts SHORT win-rate
(41.2% → 43.7%) because a losing LONG no longer holds the single-position slot
and blocks good SHORT entries.

## Takeaway

**Disabling LONG wins on every metric in every window** — 1.4–3.2× the net P&L and
materially lower drawdown (90d: PF 1.18→1.87, net +19.6→+52.4, MDD −17.9R→−6.7R).
Halving LONG size only helps partway: it bleeds less but LONG still occupies the slot
and blocks SHORTs, so it trails short-only. The single LONG component with a positive
edge is `LIQUIDITY_SWEEP` LONG (+1.19R/180d); `TREND_PULLBACK` LONG (−6.08R) is the
whole loss. **Recommendation for the current regime: run short-only (or gate LONG to
sweep-reversals only).** Caveat: this sample overlaps a BTC downtrend — a sustained
uptrend would need LONG re-enabled, so the durable fix is an H4/1D regime gate rather
than a hard LONG-off switch.
