# BTC daily price stats 2017 → now (up/down days + deepest drop before a 10% recovery)

Not a trading-strategy backtest — a descriptive statistics run on BTC spot daily candles,
requested by the user: count of up vs down days, and the deepest drawdown before price
recovered ≥10% off its low.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-daily-stats.ts BTCUSDT 10
```

## Config
- Symbol: `BTCUSDT` (Binance spot)
- Interval: `1d`
- Range: 2017-01-01 → 2026-06-27 (actual data starts 2017-08-17, Binance listing)
- Candles: 3237 (3236 day-over-day comparisons)
- Recovery filter for drawdown segmentation: **10%** rebound off the trough (intraday high/low)

## Up / Down days (close-to-close)
| Metric | Value |
|---|---|
| Up days | 1653 (51.1%) |
| Down days | 1583 (48.9%) |
| Flat days | 0 |
| Biggest single-day gain | +22.50% on 2017-12-07 |
| Biggest single-day loss | −39.50% on 2020-03-12 |

## Drawdowns confirmed by a ≥10% rebound (deepest first, top 10)
| Drop % | Peak date | Peak | Trough date | Trough | Days |
|---|---|---|---|---|---|
| 52.5% | 2020-03-12 | $7,966 | 2020-03-13 | $3,782 | 1 |
| 50.4% | 2020-03-08 | $8,887 | 2020-03-12 | $4,410 | 4 |
| 37.0% | 2018-01-14 | $14,340 | 2018-01-16 | $9,035 | 2 |
| 36.7% | 2017-12-21 | $17,310 | 2017-12-22 | $10,961 | 1 |
| 35.7% | 2021-05-17 | $46,686 | 2021-05-19 | $30,000 | 2 |
| 34.5% | 2019-10-26 | $10,370 | 2019-11-22 | $6,790 | 27 |
| 33.3% | 2018-01-16 | $13,543 | 2018-01-17 | $9,038 | 1 |
| 32.3% | 2022-05-31 | $32,399 | 2022-06-13 | $21,926 | 13 |
| 30.8% | 2018-07-25 | $8,492 | 2018-08-14 | $5,880 | 20 |
| 30.8% | 2025-10-27 | $116,400 | 2025-11-21 | $80,600 | 25 |

Total confirmed drawdown episodes: **257**.

## Drawdowns with a ≥20% rebound filter (to merge big bear markets)
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-daily-stats.ts BTCUSDT 20
```
Episodes drop from 257 → **80**. Deepest first (top 10):

| Drop % | Peak date | Peak | Trough date | Trough | Days |
|---|---|---|---|---|---|
| 58.0% | 2020-02-13 | $10,500 | 2020-03-12 | $4,410 | 28 |
| 52.5% | 2020-03-12 | $7,966 | 2020-03-13 | $3,782 | 1 |
| 52.4% | 2018-10-15 | $7,680 | 2018-11-25 | $3,653 | 41 |
| 49.6% | 2021-05-10 | $59,500 | 2021-05-19 | $30,000 | 9 |
| 45.9% | 2018-01-28 | $12,244 | 2018-02-05 | $6,625 | 8 |
| 44.6% | 2022-03-28 | $48,190 | 2022-05-12 | $26,700 | 45 |
| 42.6% | 2018-05-05 | $10,020 | 2018-06-24 | $5,750 | 50 |
| 39.6% | 2018-01-11 | $14,969 | 2018-01-16 | $9,035 | 5 |
| 39.1% | 2021-11-10 | $69,000 | 2021-12-04 | $42,000 | 24 |
| 38.9% | 2021-12-04 | $53,859 | 2022-01-24 | $32,917 | 51 |

**Deepest drop before a ≥20% recovery: −58.0%** ($10,500 on 2020-02-13 → $4,410 on 2020-03-12).

Even at 20%, the 2018 and 2021–22 bear markets stay split: BTC bear markets contain relief
rallies well above 20% (e.g. the 2021 ATH $69k → $42k leg, then a separate $53.9k → $32.9k leg).
A reversal filter only merges declines whose intermediate bounces stay *under* the threshold, so
fully merging multi-leg bears needs a higher filter (~30–40%+) or a different definition (e.g.
absolute peak-to-trough max drawdown).

## Takeaway
Over ~9 years BTC closed up on 51.1% of days vs down on 48.9% — a slight positive day-skew
consistent with its long-term uptrend. The **deepest fall before any ≥10% bounce was −52.5%**,
the March 2020 COVID crash ($7,966 → $3,782 in a single day). Note the 2018 and 2021–22 bear
markets, despite ~70–84% total peak-to-trough declines, do NOT appear as single episodes here:
they staircased down with repeated ≥10% relief bounces, so the 10% reversal filter splits them
into many shorter drawdowns. The metric therefore captures *uninterrupted* sell-offs, where COVID
was the most violent.
