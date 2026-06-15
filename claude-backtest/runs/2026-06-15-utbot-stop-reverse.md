# 2026-06-15 — UTBot stop-and-reverse on close

## Config
- Flow: stop-and-reverse on H4/D1 **candle close** (user's preferred flow), always in market
- Indicator: UTBot, ATR period **10**, keyValue swept 1–4
- Period: last **365 days** (2025-06-15 → 2026-06-15)
- Capital: **$1000**, compounded
- Fee: **0.05%/side** (= 0.1% per round-trip flip) — user's real fee

## Commands
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts BTCUSDT 4h 365 1000 0.05 "1,2,3,4"
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts ETHUSDT 4h 365 1000 0.05 "1,2,3,4"
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts BTCUSDT 1d 365 1000 0.05 "1,2,3,4"
```

## Results (NET of 0.05%/side fees)

### BTCUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 222 | 40.1% | $1,168 | +16.9% | 32.1% |
| 2 | 106 | 34.0% | $785 | −21.5% | 37.1% |
| 3 | 58 | 43.1% | $821 | −17.9% | 50.8% |
| 4 | 36 | 38.9% | $1,142 | +14.2% | 26.7% |

### ETHUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 217 | 37.8% | $1,118 | +11.8% | 44.7% |
| **2** | 90 | 41.1% | **$1,881** | **+88.1%** | 27.4% |
| 3 | 52 | 36.5% | $1,394 | +39.4% | 47.7% |
| 4 | 33 | 45.5% | $1,821 | +82.1% | 32.5% |

### BTCUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 39 | 51.3% | $1,256 | +25.6% | 26.3% |
| **2** | 14 | 42.9% | **$1,373** | **+37.3%** | **11.9%** |
| 3 | 10 | 50.0% | $1,027 | +2.7% | 23.3% |
| 4 | 6 | 50.0% | $1,252 | +25.2% | 12.4% |

## Takeaway
At the user's 0.05%/side fee, **low keyValue on H4 is killed by fees** (BTC H4 kv=1: gross
+45.8% → net +16.9%; 222 trades). Two robust picks emerge: **ETH H4 keyValue=2**
($1,000→$1,881, +88%, fee drag ~17pp) for max return, and **BTC Daily keyValue=2**
($1,373, +37%, max DD only 11.9%, 14 trades/yr) for the best risk-adjusted / lowest-fee
profile. The stop-and-reverse-on-close flow outperforms the in-repo intra-candle
`supertrend-engulfing-mtf` strategy. Caveats: single year / single regime, no slippage or
funding included.
