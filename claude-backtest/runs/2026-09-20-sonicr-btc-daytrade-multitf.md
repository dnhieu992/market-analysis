# Sonic R BTC day-trading — best intraday scenario, multi-timeframe (2024→now)

**Goal:** user day-trades BTC only (**no overnight**), wants the *best* Sonic R intraday
scenario found by backtest, sweeping **small timeframes**. Backtest window restricted to
**2024-01-01 → now** (earlier years ignored, per request).

## Method

Sonic R = EMA34 (the "Dragon", drawn on high+low+close) / EMA89 (mid) / EMA200 (macro).
Trend up = **EMA34 > EMA89 > EMA200** and price above EMA89 (stacked-bull); mirror for bear.

**Setup tested — Dragon pullback continuation** (the canonical Sonic R intraday entry):
in an established trend, price dips back into the EMA34 band (or to EMA89), then *reclaims*;
enter on the reclaim, next-bar open.
- **Entry (long):** stacked-bull, price wicked into the target band within last `lb` bars,
  current bar is a bullish body closing back above EMA34. (short = mirror in stacked-bear)
- **Stop:** structure extreme (pullback low / EMA34-low) − `slAtr`×ATR14.
- **Target:** `rr` × risk.
- **Day-trade constraint (hard):** every open position is force-closed at the end of its
  **UTC calendar day** (no overnight); no new entry in the last hour of a day. One position
  at a time, flat between.

**Data:** BTCUSDT spot klines, Binance, 2024-01-01 → 2026-09-20. Fees **0.05%/side**
(round-trip 0.10%), risk **$10/trade**. Scored in R (= net$/risk) and $.

**Sweep:** timeframe {5m, 15m, 30m, 1h} × target {dragon, river(EMA89)} × slAtr {0.25, 0.5, 1.0}
× rr {1, 1.5, 2, 3} × lookback {3, 6} × direction {long-only, both} × trend-flip-exit {off, on}
= 768 configs. Gate for "works": ≥120 trades AND positive expectancy after fees.

## Commands
```bash
node claude-backtest/scripts/sonicr-daytrade.mjs           # full 768-config sweep
node claude-backtest/scripts/sonicr-verify.mjs             # per-year robustness of the winner
```

## Results — small timeframes LOSE, only 1h is positive

Best config **per timeframe by net$** (n≥120):

| TF  | best config (net$)                          | trades | WR    | PF   | net$   | verdict |
|-----|---------------------------------------------|-------:|------:|-----:|-------:|---------|
| 5m  | river · sl1 · rr3 · lb6 · long             | 1206  | 32.6% | 0.77 | **−2144** | noise+fees destroy it |
| 15m | river · sl1 · rr3 · lb6 · long             |  537  | 40.4% | 0.86 | **−429**  | loses |
| 30m | river · sl0.25 · rr3 · lb3 · long          |  293  | 39.6% | 0.98 | **−31**   | ~breakeven, still red |
| **1h** | **dragon · sl1 · rr3 · lb6 · long** |  **417** | **45.8%** | **1.10** | **+166** | only positive edge |

Out of 768 configs, only **22** passed the gate (n≥120, expR>0) — **every one of them is 1h**.
No 5m/15m/30m config was profitable.

**Best overall config:** `1h · dragon pullback · SL=1×ATR · RR=3 · lookback=6 · LONG-ONLY · no trend-flip`
→ 417 trades, WR 45.8%, expR **0.040 R**, PF **1.10**, net **+$166**, maxDD 14.8R, ~0.42 trades/day.
Exit mix: **68% end-of-day close, 26% stop, only 6% hit the RR=3 target** — i.e. the RR barely
matters; the strategy is really "enter on a Sonic R pullback, ride the trend till session end."

## Robustness — the edge is a 2024 artifact, flat since

Same winner config, split by year:

| Year | trades | WR    | PF   | net$ | maxDD |
|------|-------:|------:|-----:|-----:|------:|
| 2024 |   168  | 50.0% | **1.23** | +141 | 9.6R |
| 2025 |   153  | 42.5% | **1.02** | +10  | 14.8R |
| 2026 |    96  | 43.8% | **1.04** | +15  | 10.9R |

Almost the entire profit came from **2024** (strong bull). In **2025–2026 the edge decayed to
~breakeven** (PF 1.02–1.04). maxDD (14.8R) ≈ total profit (16.6R) over the whole sample — a
rough ride for a thin edge.

## Takeaway / recommendation

- **The small timeframes you wanted (5m/15m/30m) do NOT work** for a Sonic R day trade on BTC:
  5m/15m lose badly, 30m is a slow bleed. Intraday noise + fees overwhelm the signal. Faster ≠ better.
- **The only positive Sonic R day-trade is on 1h, long-only, in a confirmed uptrend**
  (EMA34>EMA89>EMA200, price>EMA89), buying the reclaim of a pullback into the Dragon (EMA34),
  SL = pullback low − 1×ATR, and — because 68% of exits are the end-of-day close — the exit rule
  that actually pays is **"close by end of session, let the runner run to a wide RR=3 target."**
- **But treat it as a thin, regime-dependent timing tool, not a system.** PF 1.10 overall, and
  its profit is basically all from 2024; 2025–26 it's flat. It's fine as a *context/timing filter*
  layered on the existing macro journal (only take longs when the daily trend is up), **not** as a
  standalone money-maker, and **never counter-trend or short** (shorts + both-direction all tested worse).
- Next ideas if pursuing further: session filter (only US/EU hours), volatility/ADX regime gate,
  partial TP + breakeven trail, or accept it's break-even and drop intraday BTC day-trading in favor
  of the swing/positioning edge the other backtests found.

---
*fee 0.05%/side, risk $10/trade, BTCUSDT spot, 2024-01-01→2026-09-20. Scripts:
`claude-backtest/scripts/sonicr-daytrade.mjs` (+ `sonicr-verify.mjs`).*
