# Backtest — `/day-trading` live strategy (production-faithful)

**Date:** 2026-06-20
**Symbol:** BTCUSDT (Bitget USDT-M futures)
**Strategy:** The exact strategy running on `14.225.220.202:3001/day-trading` —
Liquidity Sweep (reversal) + Trend Pullback (continuation) on 15m, with 1H/4H
trendline trend gating. Walk-forward replay reuses the **real**
`SetupAnalyzerService.analyze()` (no copy, no lookahead).

## Commands

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- --days=60
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- --days=90
TS_NODE_TRANSPILE_ONLY=1 pnpm --filter worker backtest:daytrading -- --days=180
```

## Config (production defaults)

| Param | Value |
|-------|-------|
| Entry / mid / high TF | 15m / 1H / 4H |
| minRR | 2 |
| Stop floor (`minStopPct`) | 0.50% fixed |
| Risk per trade | $2 |
| Fee | 0.060%/side (0.120% round-trip, Bitget taker) |
| Expiry | 192 bars (48h) mark-to-market |
| Position model | single-position, SL-first tie-break |
| Management | static (no partial/BE — matches live, mgmt OFF) |

## Results (net of fees)

| Window | Signals | Win% | E[R] net | PF | net USD (risk $2) | Max DD |
|--------|--------:|-----:|---------:|----:|-----:|-------:|
| 60d  | 58  | 50.0 | +0.284 | 1.49 | +32.9 | −6.9R |
| 90d  | 86  | 43.2 | +0.114 | 1.18 | +19.6 | −17.9R |
| 180d | 168 | 39.5 | +0.041 | 1.06 | +13.8 | −17.9R |

### By side (consistent across all windows)

| Side | 60d PF | 90d PF | 180d PF |
|------|-------:|-------:|--------:|
| SHORT | 1.74 | 1.43 | 1.15 |
| LONG  | 1.00 | 0.78 | 0.85 |

### By setup (180d)

| Setup | n | Win% | E[R] net | PF |
|-------|--:|-----:|---------:|----:|
| TREND_PULLBACK | 140 | 40.0 | +0.056 | 1.09 |
| LIQUIDITY_SWEEP | 28 | 37.0 | −0.035 | 0.95 |

- Fire rate ~1.5–1.7% of 15m closes → ~1+ signal/day (matches the design target).
- Avg hold ~10–12h.

## Takeaway

The live strategy is **net-positive after fees** across every window (PF 1.06–1.49),
but the edge is fragile and almost entirely **SHORT-side**: the SHORT book is
profitable in all three windows (PF 1.15–1.74) while the **LONG book is a net loss
in 2 of 3 windows** (PF 0.78 / 0.85, breakeven at best). This is consistent with the
180d sample being captured during a BTC downtrend — the trend-following system
correctly leans short. Expectancy decays as the window lengthens (E[R] net 0.284 →
0.041), so most of the profit comes from the recent 60d. `TREND_PULLBACK` is the
workhorse (positive PF on its own); `LIQUIDITY_SWEEP` is roughly breakeven over 180d
and only carries its weight in shorter windows. Net: the system as-deployed has a
real but thin edge — worth watching that the LONG side doesn't bleed in a sustained
uptrend, where the current numbers suggest it would.
