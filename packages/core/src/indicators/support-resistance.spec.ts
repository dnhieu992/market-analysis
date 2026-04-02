import { extractSupportAndResistanceLevels } from './support-resistance';

describe('support and resistance extraction', () => {
  it('extracts nearby swing levels from candles', () => {
    const candles = [
      { high: 110, low: 98 },
      { high: 112, low: 101 },
      { high: 118, low: 105 },
      { high: 114, low: 100 },
      { high: 120, low: 107 },
      { high: 116, low: 102 },
      { high: 113, low: 99 }
    ];

    const result = extractSupportAndResistanceLevels(candles, 3);

    expect(result.supportLevels.length).toBeGreaterThan(0);
    expect(result.resistanceLevels.length).toBeGreaterThan(0);
  });
});
