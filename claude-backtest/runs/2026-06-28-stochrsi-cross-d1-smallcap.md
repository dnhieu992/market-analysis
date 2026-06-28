# StochRSI D1 bullish-cross on small-caps — does it predict pumps?

**Date:** 2026-06-28
**Claim tested:** "On Binance small/mid-cap coins, on the **D1** chart, when the two **StochRSI** lines
cross UP (%K crosses above %D), price very often pumps hard."

## Command
```bash
set -a && source .env && set +a
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-stochrsi-cross-d1-backtest.ts
```

## Config
- **Universe:** rebuilt the small-cap-radar list the same way the app does — Binance USDT `TRADING`
  pairs whose CoinGecko market cap is **$3M–$50M**. Result: **203 coins**, 195 with ≥120 daily candles.
- **Data:** public Binance D1 klines, up to 1000 candles (~2.7y) per coin. No app auth.
- **Indicator:** StochRSI TradingView defaults — RSI 14, Stoch 14, smoothK 3, smoothD 3.
- **Signal:** bullish cross = `%K crosses above %D` on a **closed** daily candle, split by the zone it fires in.
- **Forward measure:** realized hold return `close[i+w]/close[i]-1` AND best-case `maxFwd` (highest high in window),
  windows **7 / 14 / 30 days**, vs. the unconditional baseline (every day, every coin).

## Results

**BASELINE (every day):**
| win | realized median | realized mean | maxFwd median | maxFwd mean | %max≥+20% | %max≥+50% |
|----|----|----|----|----|----|----|
| 7d  | −1.7% | −0.9% | 8.0% | 13.3% | 18 | 3 |
| 14d | −4.1% | −1.8% | 11.8% | 19.8% | 31 | 7 |
| 30d | −7.9% | −3.9% | 17.5% | 30.6% | 45 | 16 |

**Oversold cross (%K<20) — 6,613 events:**
| win | realized median | realized mean | maxFwd median | maxFwd mean | %max≥+20% | %max≥+50% |
|----|----|----|----|----|----|----|
| 7d  | −0.7% | −0.6% | 8.0% | 13.2% | 17 | 3 |
| 14d | −3.2% | −1.9% | 11.2% | 19.2% | 28 | 7 |
| 30d | −9.6% | −4.8% | 17.3% | 29.7% | 45 | 15 |

**Any bullish cross — 17,379 events:**
| win | realized median | realized mean | maxFwd median | maxFwd mean | %max≥+20% | %max≥+50% |
|----|----|----|----|----|----|----|
| 7d  | −1.4% | −0.7% | 8.1% | 13.5% | 18 | 4 |
| 14d | −3.7% | −1.7% | 11.7% | 19.8% | 31 | 8 |
| 30d | −8.5% | −4.5% | 17.6% | 30.4% | 46 | 16 |

(Low `<30` and lower-half `<50` zones sit between these two — same picture.)

## Takeaway
**The claim is not supported.** A D1 StochRSI bullish cross — in any zone, including deep oversold — gives
forward returns that are **statistically identical to a randomly chosen day** on the same coins. Every column
(realized median/mean, best-case max-gain median/mean, % of events reaching +20% / +50%) matches the baseline
within noise; the oversold variant is even *slightly worse* than baseline at 14d/30d. Realized forward returns
are mildly negative everywhere simply because small-caps bleed over this sample.

Why it *feels* predictive: StochRSI 3/3 fires a bullish cross extremely often (~89 crosses/coin over 2.7y,
≈ one every 11 days), so it sits just before *most* bounces by construction — but it sits before just as many
continued drops. It is a coincident oscillator, not a forward edge. **Don't trade the bare cross.** If a small-cap
long signal is wanted, the radar's existing market-cap + weekly-trend gating (see `project_tracking_coins_entry_score`)
remains the better-validated path; a StochRSI cross could at most be a cosmetic timing tie-breaker, not an entry trigger.
