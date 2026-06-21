# Live swing strategy — effect of REMOVING the pullback add-on

**Date:** 2026-06-20
**Script:** `scripts/run-flip-pullback-backtest.ts`
**Window:** 365 days, public Binance klines · flat $100/leg · fee 0.05%/side · ATR(10)

## What "remove the pullback" means for the LIVE strategy

The live page strategy = UTBot stop-and-reverse on close (enter immediately at the flip), PLUS a
**pullback add-on** (scale-in toward the line, max 3/leg). The add-on is **production-gated to
keyValue=4** (`pullbackEnabledFor(kv)===(kv===4)`), so it only runs on **BNBUSDT 4h**. The other
three live pairs (ETH 4h kv=2, BTC 1d kv=2, SOL 1d kv=2) already have **no** pullback. So removing
the pullback changes **only BNB**.

## Result — per live config (with vs without pullback)

| Live config       | WITH pullback (live) | WITHOUT pullback | Δ | win% w→wo | maxDD |
|-------------------|---------------------:|-----------------:|------:|---|---|
| ETHUSDT 4h kv=2   | $78.0  | $78.0  | 0 (no add-on live) | 40.7% | unchanged |
| BTCUSDT 1d kv=2   | $22.5  | $22.5  | 0 (no add-on live) | 37.5% | unchanged |
| SOLUSDT 1d kv=2   | $68.0  | $68.0  | 0 (no add-on live) | 53.3% | unchanged |
| **BNBUSDT 4h kv=4** | **$159.76** (81 legs, 33.3%) | **$56.41** (30 legs, 43.3%) | **-$103.35** | 33.3%→43.3% | $32.9→~$20 |
| **TOTAL**         | **≈ $328** | **≈ $225** | **-$103.35** | | |

## Takeaway

Over 365 days, **removing the pullback HURTS by ~$103 — and 100% of it is BNB**. The add-on nearly
TRIPLES BNB's net ($56→$160); it is the single biggest profit driver on that pair (kv=4 is a clean
trender, exactly where scale-ins compound). The other three pairs are untouched.

But the trade-off is real and matches what the live book just showed:
- Removing it **raises BNB win rate 33%→43%** and **cuts maxDD ~$33→~$20** — a smoother equity curve.
- The add-on is a **high-variance amplifier**: brilliant in clean trends, painful in chop. The
  recent live BNB whipsaw (-$46.92, incl. two ADD legs -10.49/-8.63) is exactly the add-on biting
  in a range — the same mechanism that earns the +$103 over a full year.

So it is a **return-vs-smoothness** choice, not a free win:
- **Keep pullback** → higher total return (+$103/yr), but lower win rate, bigger drawdowns, and
  ugly stretches like the current chop.
- **Drop pullback** → give up the biggest single edge (BNB), but a calmer, higher-hit-rate book.

Recommendation: don't drop it based on a 5-day losing patch — over the year it's the top
contributor. If the chop pain is the real concern, the better lever is to **gate the add-on by
regime** (only scale in when the trend is confirmed strong, e.g. price extended > X% from the
line / ADX filter) rather than removing it outright.
