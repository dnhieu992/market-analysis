# 2026-06-15 — SUI UTBot stop-and-reverse on close (candidate screen)

## Config
- Flow: stop-and-reverse on **candle close** (user's preferred flow), always in market
- Indicator: UTBot, ATR period **10**, keyValue swept 1–4
- Period: last **365 days** (2025-06-15 → 2026-06-15)
- Capital: **$1000**, compounded
- Fee: **0.05%/side** (= 0.1% per round-trip flip) — user's real fee
- Purpose: decide whether to add **SUIUSDT** to the tracked list

## Commands
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts SUIUSDT 4h 365 1000 0.05 "1,2,3,4"
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts SUIUSDT 1d 365 1000 0.05 "1,2,3,4"
```

## Results (NET of 0.05%/side fees)

### SUIUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| **1** | 241 | 36.9% | **$2,141** | **+114.1%** | 41.2% |
| 2 | 101 | 34.7% | $401 | −59.9% | 75.1% |
| 3 | 55 | 38.2% | $830 | −17.0% | 49.4% |
| 4 | 31 | 35.5% | $1,355 | +35.5% | 35.4% |

### SUIUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 44 | 27.3% | $470 | −53.0% | 72.6% |
| 2 | 17 | 29.4% | $437 | −56.3% | 73.6% |
| 3 | 11 | 36.4% | $672 | −32.8% | 58.3% |
| 4 | 7 | 42.9% | $571 | −42.9% | 59.7% |

## Takeaway
**Do not trust SUI with this flow.** Daily is a clean failure — every keyValue is net
negative with 58–74% drawdowns. H4 looks tempting (kv=1 +114%) but is **not robust**:
the parameter curve swings +114% → −60% → −17% → +36% across kv 1→4. A real edge is
stable across neighboring params; this is curve-fit luck on a couple of big SUI trends,
not a durable signal. The +114% at kv=1 also rides 241 trades and a 41% DD.

**Verdict: reject (or paper-only).** Worse and far less stable than SOL. SUI's high
volatility produces a single lucky parameter rather than a robust edge. If tracked at
all, treat the kv=1 H4 result as unreliable and do **not** size real capital to it.
Caveats: single year / single regime, no slippage or funding included.
