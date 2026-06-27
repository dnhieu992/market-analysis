# RSI model sweep — which RSI "price model" is most profitable over 2 years (BTC)

**Date:** 2026-06-24
**Script:** `scripts/run-rsi-models-backtest.ts` (new)
**Window:** 730d (2024-06 → 2026-06), $1000 compounded, fee 0.05%/side, decisions on candle close.

## Commands

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-rsi-models-backtest.ts BTCUSDT 4h 730 1000 0.05
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-rsi-models-backtest.ts BTCUSDT 1d 730 1000 0.05
```

## Models compared (each swept over RSI period {7,14,21} × thresholds)

| id | type | rule |
|----|------|------|
| `mr-long` | long-only mean-rev | enter LONG when RSI crosses up through `os`; exit when RSI ≥ `ob` |
| `touch-long` | long-only mean-rev | enter when RSI ≤ `os`; exit when RSI ≥ `ob` |
| `mr-ls` | always-in counter-trend | flip LONG on cross-up of `os`, flip SHORT on cross-down of `ob` |
| `midline-ls` | always-in momentum | LONG while RSI ≥ 50, SHORT while RSI < 50 (50-cross stop-and-reverse) |
| `mom-long` | long-only momentum | LONG on RSI cross-up of 50, exit on cross-down of 50 |

Thresholds swept: os/ob ∈ {20/80, 25/75, 30/70, 35/65, 40/60}.

## Results — H4 (buy & hold over window: +2.7%)

Top by net compounded return (≥8 trades):

| model | period | os/ob | trades | win% | maxDD | return | final |
|-------|--------|-------|--------|------|-------|--------|-------|
| **touch-long** | 7 | 20/80 | 29 | 66% | 35% | **+49.6%** | $1,496 |
| mr-long | 7 | 25/75 | 44 | 61% | 32% | +43.7% | $1,437 |
| mr-long | 7 | 20/80 | 29 | 66% | 35% | +40.0% | $1,400 |
| touch-long | 7 | 25/75 | 44 | 64% | 36% | +33.1% | $1,331 |
| touch-long | 14 | 25/75 | 12 | 67% | 41% | +33.0% | $1,330 |

→ On H4 the winners are **long-only mean-reversion buying deep oversold (RSI≤20–25, period 7) and selling into overbought (≥75–80)**. Momentum models (`midline-ls`, `mom-long`) all lost on H4 — chop eats them via 23–24% win rate and fees.

## Results — D1 (buy & hold over window: −3.5%)

| model | period | os/ob | trades | win% | maxDD | return | final |
|-------|--------|-------|--------|------|-------|--------|-------|
| midline-ls | 7 | — | 100 | 33% | 36% | +67.4% | $1,674 |
| midline-ls | 14 | — | 62 | 26% | 36% | +41.9% | $1,419 |
| midline-ls | 21 | — | 58 | 19% | 32% | +39.4% | $1,394 |
| **mom-long** | 7 | — | 49 | 33% | 26% | **+36.8%** | $1,368 |
| mom-long | 14 | — | 31 | 26% | 24% | +24.2% | $1,242 |

→ On D1 it **completely flips**: the RSI-50 **momentum** models win and mean-reversion mostly loses. `midline-ls` tops the table but it's long+short and shorts are modeled frictionless (no funding) → optimistic. `mom-long` per7 (+36.8%, long-only, no funding issue, maxDD only 26%) is the most trustworthy D1 result.

## Takeaway

There is no single "best RSI model" — it's **timeframe-dependent**:
- **Intraday (H4): mean-reversion wins.** Fade extremes — buy RSI(7) ≤ 20–25, sell ≥ 75–80. Best = `touch-long` per7 20/80, **+49.6%** vs +2.7% buy&hold.
- **Daily (D1): momentum wins.** Trend with the RSI-50 line. Best trustworthy = `mom-long` per7, **+36.8%** vs −3.5% buy&hold (long-only, low DD).

Common to both winners: **short RSI period (7)** beat the textbook 14/21, and the textbook "RSI 30/70" levels were among the *worst* configs on every model. Caveats: small trade counts on period 14/21 D1 (≤9) are not significant; L/S returns exclude funding; results exclude slippage. Mean-reversion's directional edge held even though 2024–26 BTC was net flat, suggesting it's harvesting volatility rather than betting on direction.
