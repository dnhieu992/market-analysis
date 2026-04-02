import { calculateAtr } from './atr';
import { calculateEma } from './ema';
import { calculateMacd } from './macd';
import { calculateRsi } from './rsi';
import { calculateVolumeRatio } from './volume';

describe('indicator suite', () => {
  const closes = Array.from({ length: 250 }, (_, index) => 100 + index);
  const highs = closes.map((value) => value + 2);
  const lows = closes.map((value) => value - 2);
  const volumes = Array.from({ length: 250 }, (_, index) => 1000 + index * 10);

  it('calculates ema values for common periods', () => {
    expect(calculateEma(closes, 20)).toBeGreaterThan(0);
    expect(calculateEma(closes, 50)).toBeGreaterThan(0);
    expect(calculateEma(closes, 200)).toBeGreaterThan(0);
  });

  it('calculates rsi in the expected range', () => {
    const rsi = calculateRsi(closes, 14);

    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });

  it('calculates macd structure', () => {
    const macd = calculateMacd(closes);

    expect(macd).toEqual({
      histogram: expect.any(Number),
      macd: expect.any(Number),
      signal: expect.any(Number)
    });
  });

  it('calculates atr and volume ratio', () => {
    expect(calculateAtr(highs, lows, closes, 14)).toBeGreaterThan(0);
    expect(calculateVolumeRatio(volumes)).toBeGreaterThan(0);
  });
});
