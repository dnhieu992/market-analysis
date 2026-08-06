import { buildAllocationItems, buildSlices, type AllocationItem } from './allocation-pie';
import type { AssetSummary } from '@web/shared/api/types';

function item(key: string, valueUsdt: number): AllocationItem {
  return { key, label: key.toUpperCase(), valueUsdt };
}

function summary(overrides: Partial<AssetSummary['available']>): AssetSummary {
  return {
    totalUsdt: 0,
    totalDepositedUsdt: 0,
    totalWithdrawnUsdt: 0,
    currentValueUsdt: 0,
    totalSpotPnlUsdt: 0,
    totalDeployedPnlUsdt: 0,
    totalPnlUsdt: 0,
    available: {
      availableUsdt: 0,
      spentOnSpotUsdt: 0,
      spotMarketValueUsdt: 0,
      unrealizedSpotPnlUsdt: 0,
      realizedSpotPnlUsdt: 0,
      totalSpotPnlUsdt: 0,
      pricedPartially: false,
      spotPositions: [],
      spotAllocationUsdt: 0,
      liquid: [],
      deployed: [],
      ...overrides,
    },
    categories: [],
    transactions: [],
  };
}

function position(coinId: string, marketValueUsdt: number) {
  return { coinId, amount: 1, costUsdt: marketValueUsdt, marketValueUsdt, priced: true };
}

function deployed(key: string, currentValueUsdt: number) {
  return {
    key,
    label: key.toUpperCase(),
    balanceUsdt: currentValueUsdt,
    capitalUsdt: currentValueUsdt,
    currentValueUsdt,
    realizedPnlUsdt: 0,
    unrealizedPnlUsdt: 0,
    pnlUsdt: 0,
    pnlPct: 0,
    source: 'exchange' as const,
    pricedPartially: false,
  };
}

describe('buildAllocationItems', () => {
  it('splits spot into BTC, ETH and one grouped rest', () => {
    const items = buildAllocationItems(
      summary({
        spotPositions: [
          position('BTC', 2000),
          position('ETH', 800),
          position('SOL', 200),
          position('ATM', 100),
        ],
        availableUsdt: 300,
      }),
    );

    expect(items.map((i) => i.label)).toEqual(['BTC', 'ETH', 'Coin khác (2)', 'USDT khả dụng']);
    expect(items.find((i) => i.label === 'Coin khác (2)')?.valueUsdt).toBe(300);
  });

  it('names a lone other coin instead of hiding it in a group of one', () => {
    const items = buildAllocationItems(
      summary({ spotPositions: [position('BTC', 500), position('SOL', 250)] }),
    );

    expect(items.map((i) => i.label)).toEqual(['BTC', 'SOL', 'USDT khả dụng']);
  });

  it('adds every deployed bucket at its current value, not its capital', () => {
    const items = buildAllocationItems(
      summary({ availableUsdt: 100, deployed: [deployed('bitget', 420), deployed('mexc', 80)] }),
    );

    expect(items.map((i) => [i.label, i.valueUsdt])).toEqual([
      ['USDT khả dụng', 100],
      ['BITGET', 420],
      ['MEXC', 80],
    ]);
  });

  it('sums to the book current value: coins + cash + deployed', () => {
    // ledger 1000 (spot 700 + wallet 100 + bitget 200), coins cost 600 now worth
    // 660, realized 40 → available = 700 − 600 + 40 + 100 = 240.
    const items = buildAllocationItems(
      summary({
        spotPositions: [position('BTC', 660)],
        availableUsdt: 240,
        deployed: [deployed('bitget', 230)],
      }),
    );

    const total = items.reduce((sum, i) => sum + i.valueUsdt, 0);
    expect(total).toBe(1130); // 1000 ledger + 60 unrealized + 40 realized + 30 bitget
  });
});

describe('buildSlices', () => {
  it('returns nothing when every value is zero', () => {
    const { slices, pieTotal } = buildSlices([item('spot', 0), item('mexc', 0)]);
    expect(slices).toEqual([]);
    expect(pieTotal).toBe(0);
  });

  it('orders slices largest first and shares sum to 100%', () => {
    const { slices, pieTotal } = buildSlices([
      item('spot', 250),
      item('bitget', 500),
      item('mexc', 250),
    ]);

    expect(pieTotal).toBe(1000);
    expect(slices.map((s) => s.name)).toEqual(['BITGET', 'SPOT', 'MEXC']);
    expect(slices.map((s) => s.pct)).toEqual([50, 25, 25]);
    expect(slices.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(100);
  });

  it('assigns colours in fixed order, never repeating within the pie', () => {
    const { slices } = buildSlices([item('a', 5), item('b', 4), item('c', 3)]);
    expect(new Set(slices.map((s) => s.color)).size).toBe(3);
  });

  it('excludes a negative value from the pie so shares stay meaningful', () => {
    const { slices, pieTotal } = buildSlices([item('spot', 800), item('mexc', -200)]);

    expect(pieTotal).toBe(800);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.pct).toBe(100);
  });

  it('folds everything past the 8th item into one "Khác" slice', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`c${i}`, 100 - i * 10));

    const { slices, pieTotal } = buildSlices(items);

    expect(slices).toHaveLength(9); // 8 named + 1 folded
    expect(slices[8]?.name).toBe('Khác (2)');
    expect(slices[8]?.value).toBe(30); // 20 + 10
    expect(pieTotal).toBe(550);
    expect(slices.reduce((sum, s) => sum + s.value, 0)).toBe(pieTotal);
  });

  it('does not add a "Khác" slice at exactly 8 items', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`c${i}`, 10 * (i + 1)));
    const { slices } = buildSlices(items);

    expect(slices).toHaveLength(8);
    expect(slices.some((s) => s.name.startsWith('Khác'))).toBe(false);
  });
});
