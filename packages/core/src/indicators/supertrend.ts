// packages/core/src/indicators/supertrend.ts
import type { Candle } from '../types/candle';

/**
 * Supertrend, mirroring Pine Script's built-in `ta.supertrend(factor, atrPeriod)`
 * so the direction here matches what TradingView draws on the chart.
 *
 * ATR is Wilder's RMA seeded with the SMA of the first `period` true ranges
 * (that is what `ta.atr` does). Bands ratchet: the lower band only moves up
 * while price holds above it, the upper band only moves down while price holds
 * below it — a close beyond the opposite band flips the trend.
 */

export type SupertrendBar = {
  /** Supertrend line for the bar — `NaN` while ATR is still warming up. */
  value: number;
  /** true when the line sits below price (uptrend). */
  bullish: boolean;
  upperBand: number;
  lowerBand: number;
};

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

  const atr: number[] = new Array(candles.length).fill(Number.NaN);
  if (candles.length < period) return atr;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  }

  return atr;
}

/**
 * Per-candle Supertrend state. Warm-up bars (before ATR exists) come back as
 * `NaN` / `bullish: false` — callers should feed enough history that the seed
 * bar no longer matters.
 */
export function calcSupertrend(
  candles: Candle[],
  period = 10,
  multiplier = 3
): SupertrendBar[] {
  const atr = calcRmaAtr(candles, period);
  const bars: SupertrendBar[] = candles.map(() => ({
    value: Number.NaN,
    bullish: false,
    upperBand: Number.NaN,
    lowerBand: Number.NaN,
  }));

  let prevUpper = Number.NaN;
  let prevLower = Number.NaN;
  let prevValue = Number.NaN;
  let bullish = false;

  for (let i = 0; i < candles.length; i++) {
    const atrValue = atr[i];
    if (atrValue === undefined || Number.isNaN(atrValue)) continue;

    const candle = candles[i]!;
    const hl2 = (candle.high + candle.low) / 2;
    let upper = hl2 + multiplier * atrValue;
    let lower = hl2 - multiplier * atrValue;

    if (!Number.isNaN(prevLower)) {
      const prevClose = candles[i - 1]!.close;
      lower = lower > prevLower || prevClose < prevLower ? lower : prevLower;
      upper = upper < prevUpper || prevClose > prevUpper ? upper : prevUpper;
    }

    if (Number.isNaN(prevValue)) {
      // First bar with a valid ATR — Pine seeds the direction bearish.
      bullish = false;
    } else if (prevValue === prevUpper) {
      bullish = candle.close > upper;
    } else {
      bullish = !(candle.close < lower);
    }

    const value = bullish ? lower : upper;
    bars[i] = { value, bullish, upperBand: upper, lowerBand: lower };

    prevUpper = upper;
    prevLower = lower;
    prevValue = value;
  }

  return bars;
}

/**
 * true when the last candle closed in a Supertrend uptrend. Returns false when
 * there is not enough history for the ATR to be defined.
 */
export function isSupertrendBullish(
  candles: Candle[],
  period = 10,
  multiplier = 3
): boolean {
  if (candles.length < period + 1) return false;
  const bars = calcSupertrend(candles, period, multiplier);
  const last = bars[bars.length - 1];
  return last !== undefined && !Number.isNaN(last.value) && last.bullish;
}
