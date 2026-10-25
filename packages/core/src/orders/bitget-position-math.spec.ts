import {
  averageEntry,
  capitalSharePct,
  favourableMovePct,
  partialCloseSize,
  pnlAt,
  sizeFromMargin,
} from './bitget-position-math';

describe('bitget position math', () => {
  it('sizes margin × leverage ÷ price, floored to the contract precision', () => {
    expect(sizeFromMargin(1, 50, 100_000, 4)).toBe(0.0005);
    expect(sizeFromMargin(1.5, 25, 15.3, 1)).toBe(2.4); // 2.45 → 2.4
    expect(sizeFromMargin(0.3, 10, 1, 1)).toBe(3); // float noise must not floor to 2.9
    expect(sizeFromMargin(0, 20, 1)).toBe(0);
    expect(sizeFromMargin(1, 20, 0)).toBe(0);
  });

  it('averages the entry after a DCA add', () => {
    expect(averageEntry(1, 100, 1, 80)).toBe(90);
    expect(averageEntry(2, 100, 1, 70)).toBe(90);
    expect(averageEntry(0, 0, 3, 50)).toBe(50);
    expect(averageEntry(0, 0, 0, 50)).toBe(0);
  });

  it('measures the favourable move for long and short', () => {
    expect(favourableMovePct('long', 100, 101)).toBeCloseTo(1);
    expect(favourableMovePct('short', 100, 99)).toBeCloseTo(1);
    expect(favourableMovePct('short', 100, 102)).toBeCloseTo(-2);
  });

  it('computes gross PnL at a price', () => {
    expect(pnlAt('long', 100, 2, 110)).toBe(20);
    expect(pnlAt('short', 100, 2, 110)).toBe(-20);
  });

  it('expresses margin as a share of capital', () => {
    expect(capitalSharePct(5, 100)).toBe(5);
    expect(capitalSharePct(5, 0)).toBeNull();
    expect(capitalSharePct(5, null)).toBeNull();
  });

  it('sizes a partial close and returns the whole size at 100 %', () => {
    expect(partialCloseSize(0.0123, 50, 4)).toBe(0.0061);
    expect(partialCloseSize(0.0123, 100, 4)).toBe(0.0123);
    expect(partialCloseSize(10, 30, 0)).toBe(3);
    expect(partialCloseSize(10, 0, 0)).toBe(0);
  });
});
