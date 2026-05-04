// packages/core/src/indicators/ut-bot.ts
import type { Candle } from '../types/candle';

// Wilder's RMA-based ATR (same algorithm used by TradingView's UT Bot)
function calcRmaAtr(candles: Candle[], period: number): number[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1]!;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });

  const atr: number[] = new Array(candles.length).fill(0);
  if (candles.length < period) return atr;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  }

  return atr;
}

function calcUtBotTrailingStop(candles: Candle[], period: number, multiplier: number): number[] {
  const atr = calcRmaAtr(candles, period);
  const stop: number[] = new Array(candles.length).fill(0);

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i]!.close;
    const nLoss = atr[i]! * multiplier;

    if (i === 0) {
      stop[i] = close - nLoss;
      continue;
    }

    const prevClose = candles[i - 1]!.close;
    const prevStop = stop[i - 1]!;

    if (close > prevStop && prevClose > prevStop) {
      stop[i] = Math.max(prevStop, close - nLoss);
    } else if (close < prevStop && prevClose < prevStop) {
      stop[i] = Math.min(prevStop, close + nLoss);
    } else if (close > prevStop) {
      stop[i] = close - nLoss;
    } else {
      stop[i] = close + nLoss;
    }
  }

  return stop;
}

/**
 * Returns true when the last candle's close is above the UT Bot trailing stop,
 * indicating an uptrend. Requires at least `period + 1` candles.
 */
export function isUtBotUptrend(
  candles: Candle[],
  period = 10,
  multiplier = 1
): boolean {
  if (candles.length < period + 1) return false;
  const stop = calcUtBotTrailingStop(candles, period, multiplier);
  const last = candles.length - 1;
  return candles[last]!.close > stop[last]!;
}
