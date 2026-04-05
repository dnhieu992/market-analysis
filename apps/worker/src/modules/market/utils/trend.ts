import type { Candle } from '@app/core';

export type Trend = 'bullish' | 'bearish' | 'neutral';

export function detectTrend(candles: Candle[]): Trend {
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]!;
    const curr = candles[i]!;
    const next = candles[i + 1]!;

    if (curr.high > prev.high && curr.high > next.high) swingHighs.push(curr.high);
    if (curr.low < prev.low && curr.low < next.low) swingLows.push(curr.low);
  }

  if (swingHighs.length < 2 || swingLows.length < 2) return 'neutral';

  const [h0, h1] = swingHighs.slice(-2) as [number, number];
  const [l0, l1] = swingLows.slice(-2) as [number, number];

  if (h1 > h0 && l1 > l0) return 'bullish';
  if (h1 < h0 && l1 < l0) return 'bearish';
  return 'neutral';
}

export function findNearestSwingLows(candles: Candle[], close: number, count = 2): number[] {
  const swingLows: number[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]!;
    const curr = candles[i]!;
    const next = candles[i + 1]!;

    if (curr.low < prev.low && curr.low < next.low && curr.low < close) {
      swingLows.push(curr.low);
    }
  }

  return [...new Set(swingLows)]
    .sort((a, b) => Math.abs(close - a) - Math.abs(close - b))
    .slice(0, count);
}

export function findNearestSwingHighs(candles: Candle[], close: number, count = 2): number[] {
  const swingHighs: number[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]!;
    const curr = candles[i]!;
    const next = candles[i + 1]!;

    if (curr.high > prev.high && curr.high > next.high && curr.high > close) {
      swingHighs.push(curr.high);
    }
  }

  return [...new Set(swingHighs)]
    .sort((a, b) => Math.abs(close - a) - Math.abs(close - b))
    .slice(0, count);
}
