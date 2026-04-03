# Sonic R M30 Signal — Design

**Date:** 2026-04-03
**Status:** Approved, pending implementation

---

## Overview

On worker startup, fetch 100 M30 candles for BTCUSDT from Binance, compute the Sonic R Dragon (EMA 34 High / EMA 34 Low) and ATR(14), derive a directional signal with stop loss and target, then send it to Telegram.

---

## Signal Rules

### Dragon
- `dragonHigh` = EMA(34) applied to the last 100 candle **high** prices
- `dragonLow`  = EMA(34) applied to the last 100 candle **low** prices

### Direction
| Condition | Signal |
|---|---|
| close > dragonHigh | BUY |
| close < dragonLow | SELL |
| dragonLow ≤ close ≤ dragonHigh | NEUTRAL |

### Stop Loss & Target (BUY/SELL only, ATR-based 1:2 R:R)
| Signal | Stop Loss | Target |
|---|---|---|
| BUY | close − 1×ATR | close + 2×ATR |
| SELL | close + 1×ATR | close − 2×ATR |

NEUTRAL signals carry no SL or target.

---

## Output Type

```ts
type SonicRSignal = {
  symbol: string;
  timeframe: 'M30';
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  close: number;
  dragonHigh: number;
  dragonLow: number;
  atr: number;
  stopLoss?: number;
  target?: number;
};
```

---

## Telegram Message Format

**BUY/SELL:**
```
[BTCUSDT M30] 🟢 BUY Signal
Close:  83,450.00 USDT
Dragon: 83,100.00 – 83,280.00
ATR:    350.00
SL:     83,100.00 USDT
Target: 84,150.00 USDT
```

**NEUTRAL:**
```
[BTCUSDT M30] ⚪ NEUTRAL
Close:  83,200.00 USDT
Dragon: 83,100.00 – 83,280.00
Price is inside the Dragon
```

---

## Architecture

### New files
- `apps/worker/src/modules/analysis/sonic-r-signal.service.ts` — signal calculation
- `apps/worker/src/modules/analysis/sonic-r-signal.formatter.ts` — message formatting (pure function)

### Modified files
- `apps/worker/src/modules/analysis/analysis.module.ts` — provide and export `SonicRSignalService`
- `apps/worker/src/main.ts` — call `SonicRSignalService.getSignal()` on startup, send result
- `packages/config/src/` — add `'M30'` to `AnalysisTimeframe`
- `apps/worker/src/modules/market/utils/candle-timing.ts` — add `M30` to `TIMEFRAME_TO_MS`

### Unchanged
- `BinanceMarketDataService` — already fetches klines for any timeframe
- `MarketDataService` — already wraps with retry logic
- `TelegramService` — no changes needed
- `calculateEma()`, `calculateAtr()` in `@app/core` — used as-is

### Startup flow
```
main.ts
  → SonicRSignalService.getSignal('BTCUSDT')
      → MarketDataService.getCandles('BTCUSDT', 'M30', 100)
      → calculateEma(highs, 34)   → dragonHigh
      → calculateEma(lows, 34)    → dragonLow
      → calculateAtr(highs, lows, closes, 14) → atr
      → derive direction, stopLoss, target
      → return SonicRSignal
  → formatSonicRMessage(signal)
  → TelegramService.sendAnalysisMessage({ content, messageType: 'sonic-r-signal' })
```

---

## Testing

- Unit test `SonicRSignalService` with fixed candle arrays covering BUY, SELL, and NEUTRAL cases
- Unit test `formatSonicRMessage` for both BUY/SELL and NEUTRAL output shapes
- No integration test needed for this iteration

---

## Out of Scope

- Cron scheduling (wired up in a follow-up)
- Multi-symbol support
- Persistence / logging of signals
- Risk management beyond the fixed 1:2 ATR ratio
