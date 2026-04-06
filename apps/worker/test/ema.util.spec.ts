import { calculateEma } from '../src/modules/ema-signal/ema.util';

describe('calculateEma', () => {
  it('returns empty array for empty input', () => {
    expect(calculateEma([], 3)).toEqual([]);
  });

  it('returns empty array when prices fewer than period', () => {
    expect(calculateEma([1, 2], 3)).toEqual([]);
  });

  it('seeds with SMA for first value', () => {
    // SMA of [1,2,3] = 2.0, k = 2/(3+1) = 0.5
    const result = calculateEma([1, 2, 3], 3);
    expect(result[0]).toBeCloseTo(2.0);
  });

  it('applies EMA multiplier correctly', () => {
    // prices: [1,2,3,4], period=3, k=0.5
    // ema[0] = SMA(1,2,3) = 2.0
    // ema[1] = 4*0.5 + 2.0*(1-0.5) = 2 + 1 = 3.0
    const result = calculateEma([1, 2, 3, 4], 3);
    expect(result[1]).toBeCloseTo(3.0);
  });

  it('returns array of length prices.length - period + 1', () => {
    const result = calculateEma([1, 2, 3, 4, 5], 3);
    expect(result).toHaveLength(3);
  });
});
