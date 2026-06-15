# 2026-06-15 — LINK, DOGE, SHIB & ADA UTBot stop-and-reverse on close (candidate screen)

## Config
- Flow: stop-and-reverse on **candle close** (user's preferred flow), always in market
- Indicator: UTBot, ATR period **10**, keyValue swept 1–4
- Period: last **365 days** (2025-06-15 → 2026-06-15)
- Capital: **$1000**, compounded
- Fee: **0.05%/side** (= 0.1% per round-trip flip) — user's real fee
- Purpose: decide whether to add **LINKUSDT / DOGEUSDT / SHIBUSDT / ADAUSDT** to the tracked list

## Commands
```bash
for sym in LINKUSDT DOGEUSDT SHIBUSDT ADAUSDT; do
  for tf in 4h 1d; do
    TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
      scripts/run-flip-backtest.ts $sym $tf 365 1000 0.05 "1,2,3,4"
  done
done
```

## Results (NET of 0.05%/side fees)

### LINKUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 261 | 37.2% | $407 | −59.4% | 73.9% |
| 2 | 107 | 29.0% | $419 | −58.1% | 69.1% |
| 3 | 55 | 36.4% | $609 | −39.1% | 63.8% |
| **4** | 30 | 26.7% | **$1,026** | **+2.6%** | 51.3% |

### LINKUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 44 | 34.1% | $435 | −56.5% | 76.4% |
| 2 | 15 | 40.0% | $796 | −20.4% | 41.7% |
| 3 | 11 | 45.5% | $646 | −35.4% | 42.9% |
| **4** | 5 | 60.0% | **$1,073** | **+7.3%** | 24.6% |

### DOGEUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| **1** | 243 | 36.2% | **$2,237** | **+123.7%** | 47.6% |
| 2 | 111 | 31.5% | $421 | −57.9% | 73.2% |
| 3 | 59 | 32.2% | $563 | −43.7% | 51.5% |
| 4 | 36 | 41.7% | $862 | −13.8% | 33.5% |

### DOGEUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 44 | 31.8% | $916 | −8.4% | 53.0% |
| 2 | 17 | 35.3% | $556 | −44.4% | 59.5% |
| **3** | 9 | 44.4% | $1,026 | +2.7% | 33.0% |
| 4 | 9 | 33.3% | $396 | −60.5% | 65.7% |

### SHIBUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| **1** | 249 | 36.1% | $933 | −6.7% | 56.2% |
| 2 | 111 | 32.4% | $458 | −54.2% | 67.8% |
| 3 | 57 | 36.8% | $498 | −50.2% | 63.7% |
| 4 | 33 | 36.4% | $820 | −18.0% | 37.0% |

### SHIBUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 42 | 38.1% | $703 | −29.7% | 48.0% |
| 2 | 17 | 29.4% | $430 | −57.0% | 63.6% |
| **3** | 9 | 33.3% | $824 | −17.7% | 45.7% |
| 4 | 5 | 40.0% | $777 | −22.3% | 38.5% |

### ADAUSDT 4h
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| **1** | 249 | 33.7% | $735 | −26.5% | 63.0% |
| 2 | 105 | 34.3% | $521 | −47.9% | 61.2% |
| 3 | 55 | 32.7% | $717 | −28.3% | 61.9% |
| 4 | 39 | 33.3% | $676 | −32.4% | 50.6% |

### ADAUSDT 1d
| keyValue | trades | winRate | final$ | return% | maxDD% |
|---|---|---|---|---|---|
| 1 | 44 | 34.1% | $704 | −29.6% | 69.2% |
| 2 | 19 | 26.3% | $539 | −46.1% | 62.0% |
| 3 | 9 | 44.4% | $835 | −16.6% | 49.4% |
| **4** | 3 | 33.3% | **$1,247** | **+24.7%** | 27.2% |

## Takeaway
**All four are rejects with this flow — none is robust.** Every coin is net negative across
the large majority of its parameter grid, and the few positive cells are isolated, curve-fit
spikes rather than a stable edge:

- **DOGE** — H4 kv=1 looks spectacular (+123.7%) but it's the *only* positive H4 cell;
  kv=2/3/4 lose 14–58%, and Daily is choppy (kv=3 +2.7%, others −8% to −60%). Classic
  single-lucky-parameter pattern (same as SUI/XRP). Reject.
- **LINK** — kv=4 is positive on both timeframes (H4 +2.6%, Daily +7.3% DD 24.6%) which is
  *directionally* the right robustness signal, but the magnitude is trivial and every lower
  kv loses 20–59%. Marginal at best — not worth real capital. Reject / paper-only.
- **SHIB** — clean failure: **no positive cell on either timeframe** (best is H4 kv=1 at
  −6.7%). Reject.
- **ADA** — H4 all negative; Daily only positive at kv=4 (+24.7%) but on just **3 trades**,
  which is statistically meaningless. Reject.

**Verdict: do not add any of LINK / DOGE / SHIB / ADA.** None matches BNB's robustness
(same winning parameter across both timeframes with real magnitude and low DD). BNB remains
the only strong new candidate from the recent screens; ETH H4 kv=2 and BTC Daily kv=2 stay
the core picks. Caveats: single year / single regime, no slippage or funding included
(continuous-futures funding would hurt these high-beta alts more).
