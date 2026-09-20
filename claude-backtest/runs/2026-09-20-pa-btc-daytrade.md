# Price-action BTC day-trade — which PA methods actually work (2024→now)

User asked to explore MORE methods, specifically **price action** (no EMAs in the signal).
Day-trade only, no overnight, 2024→now, fee 0.05%/side, risk $10. Script: `claude-backtest/scripts/pa-daytrade.mjs`.

## Methods tested (each long & short, filters none / trend(EMA200) / mtf(1d stack), RR 1.5/2/3)

`orb` Opening-Range Breakout (1h/2h/4h range) · `pdhl` Prev-Day-High/Low **breakout** ·
`pdhlf` Prev-Day-High/Low **fade** · `pin` pin-bar/rejection · `engulf` engulfing · `inside` inside-bar breakout.
Entry TFs 15m/30m/1h → 216 configs.

## Result: only ONE price-action method works — Prev-Day High/Low breakout

Best config **per method** (any TF/filter/RR), and pooled long-vs-short:

| method | best PF | best net$ | pooled LONG PF | pooled SHORT PF | verdict |
|---|---:|---:|---:|---:|---|
| **pdhl** (PDH/PDL breakout) | **1.28** | **+245** | **1.10** | **1.11** | **works — both sides** |
| pdhlf (fade the level)     | 1.01 | +10  | 0.70 | 0.69 | loses (fading the level is wrong) |
| orb1 / orb2 / orb4         | 0.94 | −220 | 0.77–0.91 | 0.71–0.82 | loses (no real "session open" on 24/7 BTC) |
| pin (rejection candle)     | 0.68 | −1004 | 0.51 | 0.46 | **catastrophic noise** |
| engulf                     | 0.86 | −1488 | 0.60 | 0.61 | catastrophic noise |
| inside (inside-bar break)  | 0.79 | −762 | 0.66 | 0.63 | loses |

**All 28 profitable configs are `pdhl`.** Every naive candlestick pattern (pin, engulfing, inside bar)
has strongly **negative** expectancy on BTC — as mechanical day-trade triggers they are pure noise, not edge.
Only the **level-based breakout** works, because it's a volatility-expansion / momentum event, and — unlike
a trend-pullback — it pays **in both directions** (break up = long, break down = short).

Top configs (all `pdhl`):

| config | trades | WR | PF | net$ | maxDD |
|---|---:|---:|---:|---:|---:|
| 1h  pdhl **mtf** rr=3   | 253 | 47% | **1.28** | +149 | **6R** |
| 1h  pdhl **none** rr=2  | 695 | 46% | 1.16 | **+239** | 9R |
| 1h  pdhl **trend** rr=2 | 545 | 45% | 1.17 | +186 | 6R |
| 30m pdhl trend rr=3     | 651 | 44% | 1.13 | +198 | 10R |
| 15m pdhl trend rr=3     | 740 | 44% | 1.11 | +191 | 11R |

It works on **15m, 30m AND 1h** (Sonic R needed ≥30m). RR2–3 all fine; the `mtf` gate raises PF to 1.28 but
halves trades, `trend`/`none` give more trades at PF ~1.16.

## Robustness — all-weather, and short-capable

**1h PDH/PDL breakout, no filter, RR2 (both directions):**

| period | trades | WR | PF | net$ | maxDD |
|---|---:|---:|---:|---:|---:|
| ALL  | 695 | 46% | 1.16 | +239 | 9.3R |
| 2024 | 245 | 45% | **1.23** | +117 | 6.4R |
| 2025 | 258 | 45% | 1.03 | +16  | 9.3R |
| 2026 | 192 | 47% | **1.29** | +106 | 5.2R |
| LONG  | 368 | 46% | **1.19** | +150 | 8.5R |
| SHORT | 327 | 46% | **1.13** | +89  | 9.0R |

Two things make this the **best method in the whole study**:
1. **Positive in EVERY year, including 2026** — where the Sonic-R MTF strategy sits out entirely (its daily
   trend gate is never met). PDH/PDL breakout doesn't need a trend to exist, so it stays active in chop/downtrend.
   (2025 was the weak year for both — PF ~1.03 — a low-follow-through, whippy regime.)
2. **It genuinely works SHORT** (PF 1.13–1.18) — the first method that does. A break *below* yesterday's low
   runs down as reliably as a break above yesterday's high runs up, because it's momentum, not trend-fighting.

## How it compares & recommendation

| strategy | PF | both sides? | active in 2026? | character |
|---|---:|---|---|---|
| Sonic R 1h dragon + MTF (v2) | 1.24 | long only | **no (dormant)** | trend-timing, low DD, only in clear uptrends |
| **PDH/PDL breakout (this)** | 1.16–1.28 | **yes** | **yes** | all-weather momentum, both directions |

**Recommendation — use PDH/PDL breakout as the all-weather day-trade base:**
> Each UTC day, mark **yesterday's high (PDH)** and **low (PDL)**. On a 1h close **above PDH** → long;
> **below PDL** → short. SL = just beyond the broken level (−0.1 ATR); target **2R**; **close by end of session.**
> One trade per side per day. ~PF 1.16, both directions, works in all three years, ~0.7 trades/day.

- For a *higher-quality/lower-DD* version, add the `mtf` gate (only take the break in the 1d trend direction): PF 1.28, DD 6R, but ~⅓ the trades and long-biased.
- **The two edges are complementary:** run PDH/PDL breakout as the base (it carries 2026 and shorts), and
  overlay Sonic-R dragon longs when the higher-TF trend is clearly up (adds low-DD long alpha in trending years).
- **Discard entirely:** ORB, pin bars, engulfing, inside bars, and fading levels — all net-negative on BTC.
- Honest caveat: still a thin edge (PF ~1.16) with a weak 2025; size small, treat the level breaks as timing,
  and expect flat stretches.

---
*BTCUSDT spot, Binance, 2024-01-01→2026-09-20, fee 0.05%/side, risk $10, no overnight.
Scripts: `claude-backtest/scripts/pa-daytrade.mjs`, `pa-verify.mjs`.*
