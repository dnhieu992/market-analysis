# Radar signal (stage + score) as a mechanical D1 rule — ETH

**Date:** 2026-06-25
**Symbol/TF:** ETHUSDT · 1d · 1500 candles (2022-05-18 → 2026-06-25), 1291-day tradable window after 210-candle warmup
**Capital/Fee:** $1000 compounded, long-only, one position at a time · fee 0.05%/side (0.1% round-trip)

**Context:** User asked whether the Top/Small-Cap Radar scoring method (the `stage` + 0–100
`signalScore` shown on the radar page) actually has an edge if traded mechanically. Tested on
ETH first. The backtest reuses the **exact live logic** (`computeSmallCapSignal` from `@app/core`)
so it is faithful to what the radar displays.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-radar-signal-d1-backtest.ts ETHUSDT 1500 1000 0.05
# gross (isolate fee drag):
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-radar-signal-d1-backtest.ts ETHUSDT 1500 1000 0
```

## Rules
- **Entry** (tested several definitions side-by-side), evaluated on each flat day's close:
  - `BREAKOUT` — stage == 'Breakout'
  - `BREAK+TREND` — stage ∈ {Breakout, Trending}
  - `SCORE>=65 / 70 / 75` — signalScore ≥ N AND stage != 'Extended'
- **Exit** (shared): stage == 'Extended' OR rsi > 70 OR close < EMA34. Exit at that day's close.
- Final open position marked-to-market at the last close.

## Results

**Buy & Hold over the same window: +18.30% ($1,183)**

| Entry rule   | Trades | Win % | Net return | Final eq | Gross return | Avg hold | Days in mkt |
|--------------|-------:|------:|-----------:|---------:|-------------:|---------:|------------:|
| BREAKOUT     |      4 | 50.0% |   **+21.17%** | $1,212 |     +21.63%  |   11.8 d |          47 |
| BREAK+TREND  |     53 | 26.4% |     −41.53% |   $585  |     −38.31%  |    7.7 d |         406 |
| SCORE>=65    |    332 | 43.1% |     −32.76% |   $672  |      −6.23%  |    2.4 d |         784 |
| SCORE>=70    |    221 | 38.5% |     −41.28% |   $587  |     −26.70%  |    3.0 d |         661 |
| SCORE>=75    |    116 | 31.9% |     −46.80% |   $532  |     −40.21%  |    4.3 d |         497 |

## Takeaway
The radar score has **no demonstrable edge on ETH** as a mechanical entry/exit. Every
threshold variant **loses money and underperforms buy & hold (+18%)** — and not just because
of fees: even **gross** (zero fee), the best score variant (`SCORE>=65`) is still −6% with
heavy churn (332 trades, 2.4-day avg hold), and the higher thresholds are worse. The tight
`close < EMA34` exit whipsaws against immediate re-entry, so the "buy when score ≥ N" idea
both loses on timing and bleeds on fees (`SCORE>=65` paid ~27% of equity in fees: −6% gross →
−33% net). The only positive cell — strict `BREAKOUT` at +21% — fired just **4 times in 4
years** (47 days in market), far too small a sample to call an edge.

**Conclusion for the user:** keep the radar as a **screening/watchlist dashboard**, not a
trading system. "Score ≥ 65 → buy" is NOT validated — on ETH it would have lost ~33% vs +18%
for simply holding. A real entry still needs a tested setup (the UTBot stop-and-reverse flow)
plus chart confirmation. Worth re-checking on a basket of higher-beta alts before discarding
entirely, but the daily ETH result is clearly negative.
