# 2026-06-15 — SOL UTBot stop-and-reverse on close (candidate screen)

## Config
- Flow: stop-and-reverse on **candle close** (user's preferred flow), always in market
- Indicator: UTBot, ATR period **10**, keyValue swept 1–4
- Period: last **365 days** (2025-06-15 → 2026-06-15)
- Capital: **$1000**, compounded
- Fee: **0.05%/side** (= 0.1% per round-trip flip) — user's real fee
- Purpose: decide whether to add **SOLUSDT** to the tracked list

## Commands
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts SOLUSDT 4h 365 1000 0.05 "1,2,3,4"
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts SOLUSDT 1d 365 1000 0.05 "1,2,3,4"
```

## Results (NET of 0.05%/side fees)

### SOLUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 257 | 38.9% | $908 | −9.2% | 57.8% |
| 2 | 109 | 33.9% | $792 | −20.8% | 40.2% |
| 3 | 61 | 31.2% | $350 | −65.0% | 71.6% |
| 4 | 33 | 45.5% | $895 | −10.5% | 44.9% |

### SOLUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| **1** | 38 | 44.7% | **$1,573** | **+57.3%** | 38.3% |
| **2** | 16 | 50.0% | **$1,229** | **+22.9%** | 28.5% |
| 3 | 13 | 30.8% | $546 | −45.4% | 53.5% |
| 4 | 7 | 28.6% | $744 | −25.6% | 50.7% |

## Takeaway
**SOL on H4 does not work with this flow — every keyValue is net negative** (best is
kv=1 at −9.2%, but with 257 trades and a brutal 57.8% max DD). SOL chops harder than
ETH and the fee drag + whipsaw wipes the edge on the 4H timeframe.

**Daily is the only viable SOL configuration.** kv=1 returns +57.3% but is fragile
(38 trades, low-kv = fee-sensitive, 38% DD); kv=2 is the cleaner risk-adjusted pick
(+22.9%, 50% win rate, 16 trades, 28.5% DD). Both beat H4 decisively.

**Verdict: borderline / weakest of the three.** Compared to current picks — ETH H4 kv=2
(+88%) and BTC Daily kv=2 (+37%, DD only 11.9%) — SOL Daily kv=2 (+22.9%, DD 28.5%) is
clearly inferior on a risk-adjusted basis. If adding SOL for diversification, use
**Daily timeframe only, keyValue=2** and never H4. Caveats: single year / single regime,
no slippage or funding included (continuous futures funding would hurt SOL more).
