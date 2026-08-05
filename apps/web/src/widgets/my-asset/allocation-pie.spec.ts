import { buildSlices } from './allocation-pie';
import type { AssetCategory } from '@web/shared/api/types';

function category(key: string, balanceUsdt: number, sortOrder = 0): AssetCategory {
  return { id: `id-${key}`, key, label: key.toUpperCase(), sortOrder, balanceUsdt };
}

describe('buildSlices', () => {
  it('returns nothing when every balance is zero', () => {
    const { slices, pieTotal } = buildSlices([category('spot', 0), category('mexc', 0)]);
    expect(slices).toEqual([]);
    expect(pieTotal).toBe(0);
  });

  it('orders slices largest first and shares sum to 100%', () => {
    const { slices, pieTotal } = buildSlices([
      category('spot', 250),
      category('bitget', 500),
      category('mexc', 250),
    ]);

    expect(pieTotal).toBe(1000);
    expect(slices.map((s) => s.name)).toEqual(['BITGET', 'SPOT', 'MEXC']);
    expect(slices.map((s) => s.pct)).toEqual([50, 25, 25]);
    expect(slices.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(100);
  });

  it('assigns colours in fixed order, never repeating within the pie', () => {
    const { slices } = buildSlices([
      category('a', 5),
      category('b', 4),
      category('c', 3),
    ]);
    expect(new Set(slices.map((s) => s.color)).size).toBe(3);
  });

  it('excludes a negative balance from the pie so shares stay meaningful', () => {
    const { slices, pieTotal } = buildSlices([category('spot', 800), category('mexc', -200)]);

    expect(pieTotal).toBe(800);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.pct).toBe(100);
  });

  it('folds everything past the 6th bucket into one "Khác" slice', () => {
    const categories = [
      category('c1', 100),
      category('c2', 90),
      category('c3', 80),
      category('c4', 70),
      category('c5', 60),
      category('c6', 50),
      category('c7', 40),
      category('c8', 30),
    ];

    const { slices, pieTotal } = buildSlices(categories);

    expect(slices).toHaveLength(7); // 6 named + 1 folded
    expect(slices[6]?.name).toBe('Khác (2)');
    expect(slices[6]?.value).toBe(70); // 40 + 30
    expect(pieTotal).toBe(520);
    expect(slices.reduce((sum, s) => sum + s.value, 0)).toBe(pieTotal);
  });

  it('does not add a "Khác" slice at exactly 6 buckets', () => {
    const categories = Array.from({ length: 6 }, (_, i) => category(`c${i}`, 10 * (i + 1)));
    const { slices } = buildSlices(categories);

    expect(slices).toHaveLength(6);
    expect(slices.some((s) => s.name.startsWith('Khác'))).toBe(false);
  });
});
