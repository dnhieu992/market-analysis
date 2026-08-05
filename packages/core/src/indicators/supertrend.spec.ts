import type { Candle } from '../types/candle';

import { calcSupertrend, isSupertrendBullish } from './supertrend';

function makeCandles(closes: number[], range = 2): Candle[] {
  return closes.map((close, i) => ({
    open: i === 0 ? close : closes[i - 1]!,
    high: close + range,
    low: close - range,
    close,
  }));
}

describe('supertrend(10,3)', () => {
  it('turns bullish on a sustained uptrend', () => {
    const candles = makeCandles(Array.from({ length: 60 }, (_, i) => 100 + i));

    expect(isSupertrendBullish(candles)).toBe(true);
  });

  it('stays bearish on a sustained downtrend', () => {
    const candles = makeCandles(Array.from({ length: 60 }, (_, i) => 200 - i));

    expect(isSupertrendBullish(candles)).toBe(false);
  });

  it('keeps the line below price while bullish and flips it above on reversal', () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i);
    const bars = calcSupertrend(makeCandles(up));
    const last = bars[bars.length - 1]!;

    expect(last.bullish).toBe(true);
    expect(last.value).toBeLessThan(up[up.length - 1]!);

    // Crash far below the trailing lower band — the trend must flip.
    const crashed = makeCandles([...up, 60, 40]);
    const flipped = calcSupertrend(crashed);
    const lastFlipped = flipped[flipped.length - 1]!;

    expect(lastFlipped.bullish).toBe(false);
    expect(lastFlipped.value).toBeGreaterThan(40);
  });

  it('marks warm-up bars as NaN and needs more than `period` candles', () => {
    const bars = calcSupertrend(makeCandles([1, 2, 3, 4, 5]));

    expect(bars.every((bar) => Number.isNaN(bar.value))).toBe(true);
    expect(isSupertrendBullish(makeCandles([1, 2, 3, 4, 5]))).toBe(false);
  });
});
