# Price Action Signal — Design Spec

**Date:** 2026-04-04
**Status:** Approved

---

## Goal

Send a second Telegram signal alongside Sonic R so the user can compare a pure price action read against the EMA-based Sonic R signal. Both signals run on startup for BTCUSDT.

---

## Architecture

Two new files following the existing Sonic R pattern:

| Action | Path | Responsibility |
|---|---|---|
| Create | `apps/worker/src/modules/analysis/price-action-signal.service.ts` | Fetches 4h + M30 candles, runs all 4 checks, returns structured result |
| Create | `apps/worker/src/modules/analysis/price-action-signal.formatter.ts` | Pure function — formats signal or "no signal" message |
| Create | `apps/worker/test/price-action-signal.service.spec.ts` | Unit tests for signal logic |
| Create | `apps/worker/test/price-action-signal.formatter.spec.ts` | Unit tests for formatter |
| Modify | `apps/worker/src/modules/analysis/analysis.module.ts` | Add `PriceActionSignalService` to providers/exports |
| Modify | `apps/worker/src/main.ts` | Call service on startup, send formatted message to Telegram |

---

## The Four Checks

All four must align for a signal to fire. If any fails, a "no signal" message is sent instead showing what passed and what didn't.

### Check 1 — 4h Trend Structure

- Fetch last 20 4h candles
- Find swing highs (candle high > both neighbours) and swing lows (candle low < both neighbours)
- Compare last 2 swing highs and last 2 swing lows:
  - HH + HL → `BULLISH`
  - LH + LL → `BEARISH`
  - Anything else → `NEUTRAL`
- NEUTRAL blocks a signal (no BUY or SELL possible)

### Check 2 — Key Level (M30)

- Scan last 50 M30 candles for the most recent swing high and swing low
- A key level is "active" if `Math.abs(close - level) <= 1 × ATR(14)`
- For a BUY signal: must be near key support (swing low)
- For a SELL signal: must be near key resistance (swing high)

### Check 3 — Candlestick Pattern (M30, last closed candle)

**Pin bar:**
- Wick on the signal side ≥ 2× the candle body size
- Body occupies the top 30% of the candle range (bearish pin) or bottom 30% (bullish pin)

**Engulfing:**
- Current candle body fully covers the previous candle's body
- Opposite colour (bullish engulfing: current close > current open, previous close < previous open)

A bullish pattern (pin bar with lower wick, or bullish engulfing) satisfies Check 3 for BUY.
A bearish pattern satisfies Check 3 for SELL.

### Check 4 — Break of Structure + Retest (M30)

- BOS confirmed when a recent swing high/low was broken within the last 5 candles
- Retest confirmed when price has since pulled back within `0.5 × ATR` of the broken level
- Bullish BOS: swing high broken, price retested from above → satisfies Check 4 for BUY
- Bearish BOS: swing low broken, price retested from below → satisfies Check 4 for SELL

---

## Signal Result Type

```ts
export type PriceActionSignal = {
  symbol: string;
  timeframe: 'M30';
  direction: 'BUY' | 'SELL' | 'NO_SIGNAL';
  close: number;
  atr: number;
  // Check results
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  keyLevel: number | null;       // null if no active key level
  pattern: string | null;        // 'Pin Bar' | 'Engulfing' | null
  bosLevel: number | null;       // null if no BOS+retest detected
  // Only present when direction is BUY or SELL
  stopLoss?: number;
  target?: number;
};
```

---

## Signal Logic

```
if trend === NEUTRAL → direction = NO_SIGNAL
else if trend === BULLISH
  && keyLevel (support) is active
  && bullish pattern detected
  && bullish BOS+retest detected
  → direction = BUY
    stopLoss = keyLevel
    target = close + 2×ATR
else if trend === BEARISH
  && keyLevel (resistance) is active
  && bearish pattern detected
  && bearish BOS+retest detected
  → direction = SELL
    stopLoss = keyLevel
    target = close - 2×ATR
else → direction = NO_SIGNAL
```

---

## Telegram Message Format

**When signal fires (BUY example):**
```
[BTCUSDT PA M30] 🟢 BUY Signal
━━━━━━━━━━━━━━━━━━━
Close:   83,450.00 USDT
SL:      82,820.00 USDT  (key support)
Target:  84,750.00 USDT  (2×ATR)

✅ 4h trend: BULLISH (HH+HL)
✅ Key level: support at 82,820.00
✅ Pattern: Bullish Engulfing
✅ BOS retest: broke 83,100.00, retested
```

**When no signal:**
```
[BTCUSDT PA M30] ⚪ No Signal
━━━━━━━━━━━━━━━━━━━
✅ 4h trend: BULLISH (HH+HL)
✅ Key level: support at 82,820.00
❌ Pattern: none detected
❌ BOS retest: no recent break
```

Risk/reward ratio: **1:2** (same as Sonic R for clean comparison).

---

## Data Requirements

| Data | Timeframe | Limit |
|---|---|---|
| Trend structure | 4h | 20 candles |
| Key levels, patterns, BOS | M30 | 100 candles |

ATR(14) is calculated from the M30 candles.

---

## Testing Strategy

**Service tests (`price-action-signal.service.spec.ts`):**
- BUY: all 4 checks pass (bullish trend, near support, bullish pattern, bullish BOS)
- SELL: all 4 checks pass (bearish trend, near resistance, bearish pattern, bearish BOS)
- NO_SIGNAL: trend is NEUTRAL
- NO_SIGNAL: trend is bullish but pattern missing
- NO_SIGNAL: trend is bullish but BOS missing
- NO_SIGNAL: trend is bullish but no active key level

**Formatter tests (`price-action-signal.formatter.spec.ts`):**
- BUY signal formats correctly with all 4 check lines
- SELL signal formats correctly
- NO_SIGNAL formats with ✅/❌ per check
