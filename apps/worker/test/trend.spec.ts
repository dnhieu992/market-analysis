import type { Candle } from '@app/core';

import {
  detectTrend,
  findNearestSwingLows,
  findNearestSwingHighs
} from '../src/modules/market/utils/trend';

function makeCandle(high: number, low: number, close: number, i: number): Candle {
  return {
    open: close,
    high,
    low,
    close,
    volume: 100,
    openTime: new Date(Date.UTC(2026, 0, i)),
    closeTime: new Date(Date.UTC(2026, 0, i, 23, 59))
  };
}

// HH + HL pattern = bullish
const bullishCandles: Candle[] = [
  makeCandle(100, 80,  90,  1),
  makeCandle(110, 70,  95,  2), // swing low at 70
  makeCandle(120, 90,  110, 3), // swing high at 120
  makeCandle(115, 85,  100, 4), // swing low at 85 (higher than 70)
  makeCandle(130, 100, 120, 5), // swing high at 130 (higher than 120)
  makeCandle(125, 105, 115, 6),
];

// LH + LL pattern = bearish
// needs 2 swing highs (LH) and 2 swing lows (LL)
const bearishCandles: Candle[] = [
  makeCandle(118, 108, 115, 1),
  makeCandle(125, 100, 110, 2), // swing high at 125 (> 118 and > next 120); swing low at 100 (< 108 and < 105)
  makeCandle(120, 105, 112, 3),
  makeCandle(115,  88,  98, 4), // swing low at 88 (lower than 100); need another swing high after
  makeCandle(118,  93, 108, 5), // swing high at 118 (lower than 125, > 115 and > next 112)
  makeCandle(112,  92, 100, 6),
];

// Flat candles = neutral
const neutralCandles: Candle[] = Array.from({ length: 6 }, (_, i) =>
  makeCandle(100, 90, 95, i + 1)
);

describe('detectTrend', () => {
  it('returns bullish for HH+HL pattern', () => {
    expect(detectTrend(bullishCandles)).toBe('bullish');
  });

  it('returns bearish for LH+LL pattern', () => {
    expect(detectTrend(bearishCandles)).toBe('bearish');
  });

  it('returns neutral for flat candles', () => {
    expect(detectTrend(neutralCandles)).toBe('neutral');
  });

  it('returns neutral when fewer than 2 swing points detected', () => {
    expect(detectTrend([makeCandle(100, 90, 95, 1)])).toBe('neutral');
  });
});

describe('findNearestSwingLows', () => {
  it('returns 2 swing lows below close, nearest first', () => {
    // close = 115; swing lows at 70, 85 (both below 115)
    const result = findNearestSwingLows(bullishCandles, 115, 2);
    expect(result).toHaveLength(2);
    // nearest to 115 is 85, then 70
    expect(result[0]).toBe(85);
    expect(result[1]).toBe(70);
  });

  it('returns fewer than count when not enough swing lows exist', () => {
    const result = findNearestSwingLows(neutralCandles, 95, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

describe('findNearestSwingHighs', () => {
  it('returns 2 swing highs above close, nearest first', () => {
    // close = 95; swing highs at 120, 130 (both above 95)
    const result = findNearestSwingHighs(bullishCandles, 95, 2);
    expect(result).toHaveLength(2);
    // nearest to 95 is 120, then 130
    expect(result[0]).toBe(120);
    expect(result[1]).toBe(130);
  });

  it('returns fewer than count when not enough swing highs exist', () => {
    const result = findNearestSwingHighs(neutralCandles, 95, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});
