# BTC hourly buy timing — which hour of day is cheapest

## Command(s) run
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-hourly-buy-timing.ts BTCUSDT 1095   # 3y

TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-hourly-buy-timing.ts BTCUSDT 2500   # ~7y (full Binance history)
```

## Config
- Symbol: BTCUSDT spot, 1h candles
- Method: group into UTC calendar days, compute each day's mean close, then average
  each hour's %-deviation from that day's mean across all days. Also count how often
  each hour is the day's min/max close.
- No fees applied — this is descriptive statistics on where price sits within the day,
  not a P&L backtest.

## Results

### 3-year window (2023-08 → 2026-08)
- Cheapest hour on avg: **01:00 UTC (08:00 VN)**, -0.048% vs day mean
- Most expensive: 22:00 UTC (05:00 VN), +0.093%
- Spread best↔worst: 0.141%
- Hour most often the day's low: **00:00 UTC (07:00 VN)**, 12.7% of days

### ~7-year window (2019-10 → 2026-08, full available history)
- Cheapest hour on avg: **04:00 UTC (11:00 VN)**, -0.055% vs day mean
- Most expensive: 22:00 UTC (05:00 VN), +0.109%
- Spread best↔worst: 0.164%
- Hour most often the day's low: **00:00 UTC (07:00 VN)**, 12.8% of days

Both windows agree on the shape: **03:00–07:00 UTC (10:00–14:00 VN)** trades slightly
below the day's average; **21:00–23:00 UTC (04:00–06:00 VN)** trades slightly above.
00:00 UTC (07:00 VN, the daily-candle open) is disproportionately likely to be the
day's low (~13%, vs 4.2% if hours were random) — likely an artifact of daily-candle
open positioning after the Asia-session dip, not a tradeable mechanism on its own.

## Takeaway
The hour-of-day effect is **real but tiny** — best-worst spread is only 0.14–0.16%,
which is barely larger than the 0.1% round-trip fee and far smaller than BTC's typical
hourly noise (hourly stdev is >10x this spread). This is NOT enough edge to build a
standalone strategy on. It's usable only as a **free tweak on top of an existing daily
DCA**: if you're buying a fixed dollar amount every day anyway, place the order around
**10:00–14:00 VN (03:00–07:00 UTC)** rather than **04:00–06:00 VN (21:00–23:00 UTC)** —
same capital, same schedule, ~0.15% cheaper average fill with zero added risk. Do not
expect this alone to beat buy-and-hold or justify skipping days to chase the "best" hour.
