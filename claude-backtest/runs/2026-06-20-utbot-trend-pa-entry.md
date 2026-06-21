# UTBot trend + Price-Action entry (pullback + engulfing)

**Date:** 2026-06-20
**Script:** `scripts/run-flip-pa-entry-backtest.ts` (new)
**Window:** 365 days (2025-06-20 → 2026-06-20), public Binance klines
**Sizing:** flat $100/leg, no compounding · fee 0.05%/side · ATR(10) · **no add-on** (both arms)

## Rule under test

UTBot decides the **trend**; price action decides the **entry**.

- **CURRENT (live):** enter the base immediately at the UTBot flip close; exit on the next flip.
- **NEW:** inside a UTBot trend, wait for a PA entry — max ONE base per leg:
  - BULL: after ≥1 candle closing below the previous close (pullback), enter LONG on the first
    candle that is bullish (close>open) AND closes above the previous candle's HIGH.
  - BEAR: mirror (pullback up, then bearish candle closing below the previous LOW).
  - No signal before the trend flips → leg SKIPPED (flat).
  - Exit: next confirmed UTBot flip.

Add-on OFF in both arms to isolate the pure entry-timing effect. (Note: BNB CURRENT here is
$64.63 base-only vs $168 with the kv=4 add-on in earlier runs — this is the isolated base.)

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-flip-pa-entry-backtest.ts 365 0.05 100
```

## Results

| Config          | CURRENT net (win%) | NEW net (win%) | Δ | maxDD cur→new | PA entries |
|-----------------|-------------------:|---------------:|------:|---|---|
| ETHUSDT 4h kv=2 | $77.72 (40.7%) | $41.54 (38.4%) | **-36.18** | $28→$38 | 73/91, 18 skip, delay 5.3c |
| BTCUSDT 1d kv=2 | $22.45 (37.5%) | $16.28 (40.0%) | **-6.18** | $16→$27 | 15/16, 1 skip, delay 4.3c |
| BNBUSDT 4h kv=4 | $64.63 (44.8%) | $62.03 (40.7%) | **-2.60** | $20→$24 | 27/29, 2 skip, delay 6.7c |
| SOLUSDT 1d kv=2 | $68.01 (53.3%) | $71.21 (58.3%) | **+3.20** | $23→$15 | 12/15, 3 skip, delay 5.8c |
| **Total**       | **$232.81** | **$191.06** | **-$41.76** | | |

## Takeaway

Far more competitive than the distance gate (-$42 total vs -$193). The result splits by timeframe:

- **Daily (BTC, SOL) ≈ break-even to positive.** SOL actually **improves**: win rate 53%→58%
  and **maxDD $22.5→$15.2** — the pullback+engulfing filter skipped 3 weak legs and entered the
  rest at better spots. BTC is a small -$6.
- **4H (ETH, BNB) hurts**, ETH the most (-$36). The cost is **entry lag**: PA waits on average
  **5–7 candles** after the flip (≈1 day on 4H), so it misses the initial thrust that carries a
  big share of each UTBot leg. On 4H that thrust is a large fraction of the move; on daily the
  legs are longer so a few-candle delay matters less.

Net: the idea is **sound but timeframe-dependent**. It is a wash-to-slight-win on the daily
configs (and a genuine drawdown reducer on SOL) and a loser on the 4H configs because of entry
lag. It is NOT a uniform improvement over "enter at the flip". Next levers worth testing:
(1) restrict PA entry to **daily timeframes only**, keep immediate entry on 4H; (2) a **faster
confirmation** (bullish engulfing of the prior body without requiring close>prior-high) to cut
the 5–7 candle lag; (3) re-add the kv=4 pullback add-on on top of the PA base for BNB.
