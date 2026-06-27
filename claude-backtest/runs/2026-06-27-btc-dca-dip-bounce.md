# BTC DCA "buy the dip, sell the bounce" — strategy design + backtest

Goal (user): build a Bitcoin DCA strategy that profits from the recovery bounce after dips
("ăn cú tăng hồi"), motivated by the drawdown study (dips of 10–30% are frequent and mostly
mean-revert).

## Strategy mechanics
- Hold cash, track the running local peak.
- As price falls through drawdown TIERS below the peak, deploy cash in tranches.
- SELL EVERYTHING once price rebounds `+tp%` above the average cost → realize profit → reset,
  restart dip-watch from the bounce. Capital compounds across cycles.
- Fills at the exact tier/TP level (limit-order assumption), intraday via daily high/low.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-dca-dip-bounce-backtest.ts BTCUSDT
```

## Config
- Symbol BTCUSDT spot, 1d, 2017-08-17 → 2026-06-27 (3237 candles)
- Capital $1000, fully compounded, fee 0.05%/side

## Results
| Strategy | Final | Return | Cycles | Avg cycle days | Time in mkt | Max equity DD |
|---|---|---|---|---|---|---|
| **Buy & Hold** | $14,108 | +1311% | – | – | 100% | 83% |
| Weekly DCA (hold forever) | $4,114 | +311% | – | – | 100% | 68% |
| **A shallow** −10/15/20/25, tp+15 | **$19,604** | **+1860%** | 40 | 66 | 91% | 81% |
| B medium −10/20/30/40, tp+20 | $6,358 | +536% | 26 | 105 | 94% | 75% |
| C deep −15/25/35/50, tp+25 | $4,577 | +358% | 16 | 160 | 87% | 78% |
| D weighted-deep −10/20/35/55, tp+30 | $5,404 | +440% | 18 | 155 | 96% | 76% |
| E quick-scalp −8/14/20, tp+12 | $17,962 | +1696% | 47 | 58 | 94% | 81% |

All unfiltered DCA configs are still holding at the end (June 2026 is mid-dip), which is expected.

### + 200-DMA regime filter (buy dips only while close > 200DMA, cut to cash below it)
| Strategy | Final | Return | Cycles | Time in mkt | Max equity DD |
|---|---|---|---|---|---|
| A shallow [200DMA] | $821 | −18% | 45 | 35% | 75% |
| B medium [200DMA] | $677 | −32% | 34 | 37% | 60% |
| C deep [200DMA] | $839 | −16% | 28 | 28% | 52% |
| D weighted-deep [200DMA] | $1,141 | +14% | 29 | 41% | 46% |
| E quick-scalp [200DMA] | $1,481 | +48% | 62 | 38% | 72% |

**The regime filter backfires badly.** It cuts max DD (down to 46–75%) but collapses returns to
roughly breakeven/loss. Reason: BTC's best dip entries and most violent V-recoveries (e.g. Mar-2020,
early-bull turns) happen right at/below the 200-DMA. Cutting below the 200-DMA repeatedly *sells the
exact bottom* and then misses the snap-back — classic whipsaw. For BTC, holding through the dip is
what captures the bounce; a trend-stop destroys the very edge we're trying to harvest.

## Takeaway
- **Shallow + frequent wins.** A (+1860%) and E (+1696%) beat Buy & Hold (+1311%) by compounding
  BTC's many frequent 8–25% bounces. Deep/patient configs (C, D) *underperform* — waiting for
  −35/−50% dips means sitting in cash through most of BTC's uptrend (opportunity cost dominates).
- **The edge is real but the drawdown is NOT reduced.** Max equity DD stays ~75–81%, basically the
  same pain as Buy & Hold. Reason: in a deep bear the strategy deploys all tranches early, then the
  `+tp` target is never hit, so it just *holds through* the entire bear like B&H. A pure dip-buy /
  bounce-sell scheme without a trend/stop exit behaves like buy-and-hold during bears.
- **Implication:** the recovery-bounce edge boosts returns vs B&H in a structurally-rising asset,
  but to actually cut the 80% drawdown you need a regime filter (e.g. only deploy when price is
  above the 200-day MA, go/stay in cash below it) — a separate test to run next.

## Recommendation
Primary: **Config A** (tiers −10/−15/−20/−25% from local peak, 25% of cash each, sell all at
+15% above avg cost). Highest return, simple, mechanical. Accept that it carries full bear-market
drawdown. If lower drawdown matters more than max return, add a 200-DMA regime filter.
