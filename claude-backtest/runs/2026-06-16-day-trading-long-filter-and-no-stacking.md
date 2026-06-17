# 2026-06-16 — /day-trading: HH-confirmed LONG filter + no-stacking guard

## Why
Review of the live `/day-trading` page: on 06-15 → 06-16 **all 5 closed trades were
`TREND_PULLBACK` LONG and all hit SL** (−$10.1 total). 3 of them opened within 45m
(00:00 / 00:15 / 00:45 UTC) and were all stopped by the single 02:00 H1 candle that
dropped to 65751. Root causes hypothesised:
1. `trendlineTrend()` calls "up" from **rising swing lows alone** — after a top it stays
   "up" while price already carves LOWER HIGHS, so the bot keeps buying pullbacks into a
   rolling-over market.
2. No single-open-position guard; `maxLossesPerDay` only counts **closed** losers, so a
   burst of correlated entries all open before any closes.

## Tooling
Walk-forward harness `apps/worker/src/scripts/backtest-day-trading.ts` — replays the REAL
`SetupAnalyzerService.analyze()` at each 15m close (no lookahead), simulates forward to
TP/SL. Real fee **0.05%/side** (`--fee=0.0005`), risk $2/trade, single-position default.

## Commands
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- --days=365 --fee=0.0005
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- --days=180 --fee=0.0005
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- --days=365 --fee=0.0005 --allow-stack
```

## Changes tested
- **V1 (symmetric):** require HH for `up` AND LL for `down` in `trendlineTrend`.
- **V2 (asymmetric, shipped):** require HH (last swing high > prior) for `up` only;
  leave `down` on the falling-highs trendline alone.
- **Stacking:** single-position (the fix) vs `--allow-stack` (≈ current live).

## Results — 365d, net of 0.10% round-trip fee, $2 risk

| Config | OVERALL net | PF | LONG net | LONG PF | SHORT net | SHORT PF | Max DD |
|---|---|---|---|---|---|---|---|
| **Baseline (live)** | +$52.9 | 1.11 | **−$37.0** | 0.83 | +$89.9 | 1.32 | −17.2R |
| V1 symmetric HH+LL | +$5.3 | 1.01 | −$8.6 | 0.94 | **+$14.0** | 1.05 | −16.5R |
| **V2 asymmetric HH** | **+$70.3** | **1.15** | −$17.5 | 0.86 | +$87.8 | 1.25 | −17.5R |

180d (recent regime), V2: OVERALL +$56.7 (PF 1.21), **LONG +$5.7 (PF 1.09)**, SHORT +$51.0.

Stacking cost (V2, 365d): single-position **+$70.3, MaxDD −17.5R** vs `--allow-stack`
**+$106.6 but MaxDD −182.4R** (2298 trades). At $2 risk that is −$35 vs **−$364** drawdown.

## Takeaway
- **V1 is wrong:** adding the LL gate to `down` gutted the profitable SHORT engine
  (PF 1.32 → 1.05, +$90 → +$14). SHORT backtests best on the falling-highs trendline alone.
- **V2 is the win:** HH-confirming the LONG side only lifts OVERALL +$52.9 → **+$70.3**,
  leaves SHORT essentially untouched (+$87.8), and halves the LONG bleed (−$37 → −$17.5;
  LONG is **positive in the recent 180d**). Fire rate 1.97% → 1.75% (drops only the stale
  topping-phase LONGs).
- **No-stacking guard is the bigger safety win:** stacking nominally earns more gross USD
  by taking 6× the trades but explodes MaxDD ~10× (−17.5R → −182.4R) at equal per-trade
  risk — exactly the 3-LONGs-one-candle blowup seen on 06-16.

## Shipped patch
- `setup-analyzer.service.ts` `trendlineTrend()`: `up` now also requires the last swing
  high > the prior swing high (HH). `down` unchanged.
- `day-trading.service.ts` `scan()`: skip if `findActiveSignals(SYMBOL)` is non-empty
  (one open position at a time), placed before the daily-count/loss guards.

## Caveats
Single-symbol (BTCUSDT), Bitget USDT-M history; excludes slippage & funding. LONG is still
marginally net-negative over the full year — it is now a small drag, not a bleeder, and the
SHORT engine carries the system.
