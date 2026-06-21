# H4-only: UTBot trend + pullback-to-line + engulfing entry (1 pos/leg, no adds)

**Date:** 2026-06-20
**Script:** `scripts/run-h4-pullback-engulf-backtest.ts` (new)
**Window:** 365 days, public Binance klines, **4h only**
**Sizing:** flat $100/leg · fee 0.05%/side · ATR(10) · no add-on either side

## Rule under test (user spec)

- Trend = UTBot stop-and-reverse on close; the UTBot stop is the "trend line". A flip = new trend.
- **Do NOT enter on the break.** Wait for a pullback to **within `bandPct` (1% / 2%) of the line**
  AND an **engulfing** candle there (bull: close>open & close>prev high; bear: mirror) → enter.
- **One position per leg, no scale-in.** Exit on the next UTBot flip. No qualifying candle → skip leg.
- CURRENT (reference) = live behaviour: enter immediately at the flip close.

## Results

Δ = NEW − CURRENT (net PnL, $100/leg).

### band 1%
| Config            | CURRENT net (win%) | NEW net (win%) | Δ | NEW trades / legs | maxDD cur→new |
|-------------------|-------------------:|---------------:|------:|---|---|
| ETHUSDT 4h kv=2 (live)  | $78.10 (40.7%) | -$2.60 (0%)   | -80.70 | 2/91   | $28→$2.6 |
| BNBUSDT 4h kv=4 (live)  | $56.39 (43.3%) | $23.10 (66.7%) | -33.28 | 3/30   | $20→$1.3 |
| BTCUSDT 4h kv=2 (extra) | -$24.84 (33.3%)| -$2.02 (28.6%) | +22.82 | 7/108  | $44→$6.4 |
| SOLUSDT 4h kv=2 (extra) | -$2.08 (33.6%) | -$1.89 (0%)    | +0.19  | 1/110  | $50→$1.9 |
| **TOTAL**         | **$107.56** | **$16.59** | **-90.97** | | |

### band 2%
| Config            | CURRENT net | NEW net (win%) | Δ | NEW trades / legs | maxDD cur→new |
|-------------------|------------:|---------------:|------:|---|---|
| ETHUSDT 4h kv=2 (live)  | $78.10 | -$5.32 (26.7%) | -83.42 | 15/91  | $28→$26 |
| BNBUSDT 4h kv=4 (live)  | $56.39 | $38.21 (40.0%) | -18.17 | 10/30  | $20→$5.3 |
| BTCUSDT 4h kv=2 (extra) | -$24.84 | -$6.12 (31.3%) | +18.73 | 48/108 | $44→$22 |
| SOLUSDT 4h kv=2 (extra) | -$2.08 | $14.36 (40.0%) | +16.44 | 15/110 | $50→$11 |
| **TOTAL**         | **$107.56** | **$41.14** | **-66.43** | | |

## Takeaway

**As specified on H4 the rule barely trades and underperforms the live immediate-entry on the
real pairs.** Root cause is structural: the UTBot stop is a *trailing* line that sits ~nLoss
(=keyValue×ATR) away from price during a healthy trend, so price only comes within 1–2% of it
when the trend is **already dying / about to flip**. Requiring an engulfing exactly there is
doubly rare — entries collapse to **1–15 trades/year** (vs 91–110 flips) and fire on average
**13–79 candles** into the leg. You end up flat most of the time (hence the tiny drawdowns,
which are not a real edge — just non-participation).

The split is informative, though:
- On configs where CURRENT is **good** (ETH 4h +$78, the live workhorse), the filter throws away
  the winners → big loss (-$80). BNB stays positive but smaller ($56→$38).
- On configs where CURRENT **over-trades and loses** (BTC/SOL 4h kv=2: 108–110 flips, negative
  net), the hard filter **helps** — mostly by *not* trading the chop (SOL turns +$14).

So this setup is a *trade-reducer that helps bad/over-trading configs and hurts the good ones* —
net-negative overall (-$66 at band 2%, the better of the two). It is **not** an improvement for
the live H4 pairs.

## Follow-up: DROP the pullback/distance filter — engulfing-only entry (H4)

Keep only the engulfing confirmation; enter on the FIRST engulfing in the trend direction, any
distance from the line, 1 pos/leg, exit on flip. (Script with `bandPct=1000` to disable the gate.)

| Config            | CURRENT net (win%) | NEW net (win%) | Δ | entries | maxDD cur→new | avg delay |
|-------------------|-------------------:|---------------:|------:|---|---|---|
| ETHUSDT 4h kv=2 (live)  | $78.00 (40.7%) | $42.23 (36.3%) | **-35.78** | 80/91 | $28→$50 | 3.4c |
| BNBUSDT 4h kv=4 (live)  | $56.31 (43.3%) | $71.80 (44.4%) | **+15.49** | 27/30 | $20→$18 | 4.3c |
| BTCUSDT 4h kv=2 (extra) | -$24.87 (33.3%)| -$12.47 (34.4%)| **+12.40** | 90/108 | $44→$44 | 3.5c |
| SOLUSDT 4h kv=2 (extra) | -$1.90 (33.6%) | $6.44 (33.3%)  | **+8.34**  | 90/110 | $50→$53 | 4.0c |
| **TOTAL**         | **$107.55** | **$108.00** | **+0.45** | | | |

Dropping the pullback filter changes everything: entries jump from 1–15/yr to **27–90/yr** (80–90%
of legs), the entry lag falls to **~3–4 candles**, and the total is a **dead heat with CURRENT
(+$0.45)** — vs -$66…-$91 when the pullback filter was on. It actually **helps 3 of 4 configs**
(BNB +$15, BTC +$12, SOL +$8); **ETH 4h is the lone loser (-$36)** because its immediate-flip
edge is strong and even a 3–4 candle engulfing delay sacrifices it. Note maxDD is NOT reduced
(ETH $28→$50) — the engulfing confirmation does not cut risk here, it just slightly reshuffles
which legs are caught.

Conclusion: the **pullback-to-line condition was the whole problem**; the engulfing filter on its
own is roughly neutral vs entering at the flip — a wash on the live pairs in aggregate (ETH worse,
BNB better). Not a clear improvement to ship, but no longer destructive.

The real problem with the pullback variant is the **anchor**: a trailing stop is the wrong line to "pull back to". A
pullback-to-line + engulfing setup wants a line price oscillates *around*, e.g. **EMA34** (the
page already computes EMA34 extension). Next test worth running: replace the UTBot-line proximity
condition with "pullback to EMA34 (±1–2%) + engulfing, trend still bull per UTBot" — that should
trigger far more often and at live points in the trend rather than at its death.
