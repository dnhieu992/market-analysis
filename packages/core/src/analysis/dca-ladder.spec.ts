import {
  tierPctBelow,
  tierPrices,
  computePosition,
  computeTpPrice,
  computeRealizedPnl,
  computeBudget,
} from './dca-ladder';

const SPEC = { firstTierPct: 5, numTiers: 10, stepPct: 1.5 };

describe('dca-ladder math', () => {
  it('tierPctBelow yields the spec ladder', () => {
    expect(tierPctBelow(SPEC)).toEqual([5, 6.5, 8, 9.5, 11, 12.5, 14, 15.5, 17, 18.5]);
  });

  it('tierPrices are peak discounted by each tier pct', () => {
    const prices = tierPrices(100_000, SPEC);
    expect(prices[0]).toBeCloseTo(95_000, 6);
    expect(prices[9]).toBeCloseTo(81_500, 6);
  });

  it('computePosition bakes the buy fee into avgCost', () => {
    const pos = computePosition([{ price: 100, usd: 100 }], 0.05);
    // qty = (100/100) * (1 - 0.0005) = 0.9995
    expect(pos.positionSize).toBeCloseTo(0.9995, 9);
    expect(pos.capitalDeployed).toBe(100);
    expect(pos.avgCost).toBeCloseTo(100 / 0.9995, 9);
  });

  it('computePosition blends multiple fills', () => {
    const pos = computePosition(
      [{ price: 100, usd: 100 }, { price: 80, usd: 100 }],
      0,
    );
    expect(pos.positionSize).toBeCloseTo(1 + 1.25, 9); // 2.25
    expect(pos.capitalDeployed).toBe(200);
    expect(pos.avgCost).toBeCloseTo(200 / 2.25, 9);
  });

  it('computePosition on no fills is zero', () => {
    expect(computePosition([], 0.05)).toEqual({ avgCost: 0, positionSize: 0, capitalDeployed: 0 });
  });

  it('computeTpPrice is avgCost +tpPct', () => {
    expect(computeTpPrice(100, 10)).toBeCloseTo(110, 9);
  });

  it('computeRealizedPnl nets the sell fee against deployed capital', () => {
    // positionSize 2.25, sell @ 110, deployed 200, fee 0
    expect(computeRealizedPnl(2.25, 88.9, 110, 200, 0)).toBeCloseTo(2.25 * 110 - 200, 6);
    // with 0.05% sell fee
    expect(computeRealizedPnl(2.25, 88.9, 110, 200, 0.05)).toBeCloseTo(2.25 * 110 * 0.9995 - 200, 6);
  });

  it('computeBudget compounds realized pnl onto start capital', () => {
    expect(computeBudget(1000, [])).toBe(1000);
    expect(computeBudget(1000, [120, -30])).toBe(1090);
  });
});
