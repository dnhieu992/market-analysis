# 2026-06-15 — BNB & XRP UTBot stop-and-reverse on close (candidate screen)

## Config
- Flow: stop-and-reverse on **candle close** (user's preferred flow), always in market
- Indicator: UTBot, ATR period **10**, keyValue swept 1–4
- Period: last **365 days** (2025-06-15 → 2026-06-15)
- Capital: **$1000**, compounded
- Fee: **0.05%/side** (= 0.1% per round-trip flip) — user's real fee
- Purpose: decide whether to add **BNBUSDT** / **XRPUSDT** to the tracked list

## Commands
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts BNBUSDT 4h 365 1000 0.05 "1,2,3,4"
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts BNBUSDT 1d 365 1000 0.05 "1,2,3,4"
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts XRPUSDT 4h 365 1000 0.05 "1,2,3,4"
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-backtest.ts XRPUSDT 1d 365 1000 0.05 "1,2,3,4"
```

## Results (NET of 0.05%/side fees)

### BNBUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 249 | 36.6% | $1,044 | +4.5% | 46.1% |
| 2 | 97 | 38.1% | $1,180 | +18.0% | 31.3% |
| 3 | 63 | 31.8% | $669 | −33.1% | 51.2% |
| **4** | 28 | 42.9% | **$1,711** | **+71.1%** | **18.8%** |

### BNBUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 39 | 35.9% | $979 | −2.1% | 40.0% |
| 2 | 14 | 50.0% | $1,146 | +14.6% | 24.4% |
| 3 | 12 | 50.0% | $1,001 | +0.1% | 20.1% |
| **4** | 6 | 66.7% | **$1,424** | **+42.4%** | **17.3%** |

### XRPUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| **1** | 235 | 40.9% | **$1,545** | **+54.5%** | 37.4% |
| 2 | 113 | 32.7% | $615 | −38.5% | 54.7% |
| 3 | 59 | 35.6% | $640 | −36.0% | 55.0% |
| 4 | 40 | 30.0% | $528 | −47.2% | 58.2% |

### XRPUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 36 | 44.4% | $1,072 | +7.2% | 33.4% |
| 2 | 15 | 33.3% | $803 | −19.7% | 50.5% |
| **3** | 7 | 57.1% | $1,285 | +28.5% | 21.1% |
| 4 | 5 | 60.0% | $889 | −11.1% | 35.3% |

## Takeaway
**BNB is the strongest new candidate so far — and it's robust.** keyValue=4 is the best
config on **both** timeframes (H4 +71%, DD 18.8%; Daily +42%, DD 17.3%, 67% win rate),
and BNB is net positive or flat in most configs rather than relying on one lucky param.
High-kv = few trades = low fee drag. The fact the same parameter wins across two
timeframes with low drawdown is a genuine robustness signal. **Add BNB, prefer kv=4
(Daily for lowest DD, H4 for more return).**

**XRP is a reject — not robust.** H4 only works at kv=1 (+54.5%) while kv=2/3/4 all lose
36–47%; Daily is choppy (kv=3 +28% but kv=2/4 negative). Same curve-fit pattern as SUI:
one lucky parameter, no stable edge. Do not add (or paper-only).

Caveats: single year / single regime, no slippage or funding included.
