import { scanChartPatterns, ALL_PATTERNS, type PatternSeries } from './chart-patterns';

/** Build a thin-candle series by linearly interpolating between anchor prices. */
function line(anchors: number[], seg = 8): PatternSeries {
  const vals: number[] = [anchors[0]!];
  for (let i = 1; i < anchors.length; i++) {
    const from = anchors[i - 1]!;
    const to = anchors[i]!;
    for (let s = 1; s <= seg; s++) vals.push(from + ((to - from) * s) / seg);
  }
  return { highs: [...vals], lows: [...vals], closes: [...vals] };
}

describe('scanChartPatterns', () => {
  it('detects a double bottom (bullish) breaking the neckline', () => {
    const s = line([130, 100, 120, 101, 121]);
    const m = scanChartPatterns(s, ['double_bottom']);
    expect(m).toHaveLength(1);
    expect(m[0]!.pattern).toBe('double_bottom');
    expect(m[0]!.direction).toBe('bullish');
    expect(m[0]!.neckline).toBeCloseTo(120, 0);
  });

  it('detects a double top (bearish)', () => {
    const s = line([100, 130, 108, 129, 107]);
    const m = scanChartPatterns(s, ['double_top']);
    expect(m).toHaveLength(1);
    expect(m[0]!.pattern).toBe('double_top');
    expect(m[0]!.direction).toBe('bearish');
  });

  it('detects an inverse head & shoulders (bullish)', () => {
    const s = line([120, 100, 115, 90, 116, 100, 113]);
    const m = scanChartPatterns(s, ['inverse_head_shoulders']);
    expect(m).toHaveLength(1);
    expect(m[0]!.pattern).toBe('inverse_head_shoulders');
    expect(m[0]!.pivots.find((p) => p.role === 'head')!.price).toBeCloseTo(90, 0);
  });

  it('detects a head & shoulders (bearish)', () => {
    const s = line([90, 110, 97, 122, 96, 110, 101]);
    const m = scanChartPatterns(s, ['head_shoulders']);
    expect(m).toHaveLength(1);
    expect(m[0]!.pattern).toBe('head_shoulders');
    expect(m[0]!.direction).toBe('bearish');
  });

  it('does not fire a double bottom on a steady uptrend', () => {
    const s = line([100, 110, 120, 130, 140, 150]);
    expect(scanChartPatterns(s, ALL_PATTERNS).some((m) => m.pattern === 'double_bottom')).toBe(false);
  });

  it('does not fire a double bottom when the right leg makes a lower high below the neckline and rolls over', () => {
    // Two ~equal lows (100 / 101) with a 120 neckline between, but after the second low
    // price only recovers to 113 (below the 120 neckline) and turns down — a failed right
    // leg / topping rejection, not a completing double bottom. (Mirrors BTC D1 2026-07.)
    const s = line([130, 100, 120, 101, 113, 105]);
    expect(scanChartPatterns(s, ['double_bottom'])).toHaveLength(0);
  });

  it('returns [] for too-short series', () => {
    expect(scanChartPatterns({ highs: [1, 2], lows: [1, 2], closes: [1, 2] }, ALL_PATTERNS)).toEqual([]);
  });
});
