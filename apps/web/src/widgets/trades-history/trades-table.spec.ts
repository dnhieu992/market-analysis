import type { DashboardOrder } from '@web/shared/api/types';
import { calcUnrealizedPnl, getPageNumbers } from './trades-table';

function makeOrder(overrides: Partial<DashboardOrder> = {}): DashboardOrder {
  return {
    id: '1',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'open',
    entryPrice: 100,
    quantity: 1,
    openedAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    closePrice: null,
    pnl: null,
    note: null,
    images: [],
    broker: null,
    exchange: null,
    orderType: null,
    leverage: null,
    signalId: null,
    ...overrides,
  };
}

describe('calcUnrealizedPnl', () => {
  it('returns 0 when prices map is empty', () => {
    const orders = [makeOrder({ symbol: 'BTCUSDT', entryPrice: 100, quantity: 2, side: 'long' })];
    expect(calcUnrealizedPnl(orders, {})).toBe(0);
  });

  it('sums pnl for orders with matching prices', () => {
    const orders = [
      makeOrder({ symbol: 'BTCUSDT', entryPrice: 100, quantity: 2, side: 'long' }),
      makeOrder({ id: '2', symbol: 'ETHUSDT', entryPrice: 200, quantity: 1, side: 'long' }),
    ];
    const pricesMap = { BTCUSDT: 110, ETHUSDT: 220 };
    // BTCUSDT: (110 - 100) * 2 = 20; ETHUSDT: (220 - 200) * 1 = 20; total = 40
    expect(calcUnrealizedPnl(orders, pricesMap)).toBe(40);
  });

  it('skips orders with no price in the map', () => {
    const orders = [
      makeOrder({ symbol: 'BTCUSDT', entryPrice: 100, quantity: 2, side: 'long' }),
      makeOrder({ id: '2', symbol: 'ETHUSDT', entryPrice: 200, quantity: 1, side: 'long' }),
    ];
    const pricesMap = { BTCUSDT: 110 };
    // Only BTCUSDT counted: (110 - 100) * 2 = 20
    expect(calcUnrealizedPnl(orders, pricesMap)).toBe(20);
  });

  it('handles negative pnl values (short positions)', () => {
    const orders = [makeOrder({ symbol: 'BTCUSDT', entryPrice: 100, quantity: 2, side: 'short' })];
    const pricesMap = { BTCUSDT: 110 };
    // short: (100 - 110) * 2 = -20
    expect(calcUnrealizedPnl(orders, pricesMap)).toBe(-20);
  });

  it('handles undefined openOrders', () => {
    expect(calcUnrealizedPnl(undefined as unknown as DashboardOrder[], { BTCUSDT: 100 })).toBe(0);
  });
});

describe('getPageNumbers', () => {
  it('returns all pages when total pages ≤ 5', () => {
    expect(getPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageNumbers(3, 4)).toEqual([1, 2, 3, 4]);
  });

  it('returns a window around current page for large page counts', () => {
    const pages = getPageNumbers(5, 10);
    expect(pages[0]).toBe(1);
    expect(pages).toContain(5);
    expect(pages).toContain('...');
    expect(pages[pages.length - 1]).toBe(10);
  });

  it('clamps window at the end of pages', () => {
    const pages = getPageNumbers(10, 10);
    expect(pages[0]).toBe(1);
    expect(pages).toContain('...');
    expect(pages[pages.length - 1]).toBe(10);
  });
});
