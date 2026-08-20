import { renderToStaticMarkup } from 'react-dom/server';

import Page from './page';
import { createApiClient } from '@web/shared/api/client';

jest.mock('next/headers', () => ({
  headers: jest.fn(() => new Headers({ cookie: 'market_analysis_session=test-token' }))
}));

jest.mock('@web/shared/api/client', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

// Relative to now so the trade stays inside the 30-day default period the
// performance sections filter on.
const openedAt = new Date(Date.now() - 4 * 86400_000);
const closedAt = new Date(Date.now() - 3 * 86400_000);

const closedOrder = {
  id: 'order-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'closed',
  entryPrice: 60000,
  closePrice: 63000,
  quantity: 1,
  leverage: 1,
  pnl: 300,
  openedAt,
  closedAt,
  createdAt: openedAt,
  updatedAt: closedAt,
  note: null,
  source: 'manual',
  exchange: null,
  signalId: null,
};

/** Same wire shape as a Bitget closed trade — one mapper covers both. */
const mexcTrade = {
  positionId: 'mexc-1',
  tradeKey: 'SOLUSDT-long-x',
  status: 'closed',
  symbol: 'SOLUSDT',
  holdSide: 'long',
  marginMode: 'cross',
  openAvgPrice: 100,
  closeAvgPrice: 105,
  size: 10,
  netProfit: 50,
  netProfitPct: 5,
  totalFunding: 0,
  feesUsd: 0,
  openedAt: openedAt.toISOString(),
  closedAt: closedAt.toISOString(),
};

describe('P&L hub page', () => {
  beforeEach(() => {
    mockedCreateApiClient.mockReturnValue({
      fetchOrders: async () => ({
        data: [closedOrder],
        total: 1,
        page: 1,
        pageSize: 1000,
        closedPnlSum: 300,
        openOrders: [],
      }),
      fetchBitgetHistory: async () => ({ trades: [] }),
      fetchMexcHistory: async () => ({ trades: [] }),
      fetchPortfolioPnlCalendar: async () => ({
        daily: [{ date: closedAt.toISOString().slice(0, 10), realizedPnl: 120 }],
        byCoin: [{ coinId: 'ETH', realizedPnl: 120 }],
      }),
    } as unknown as ReturnType<typeof createApiClient>);
  });

  it('opens the combined overview tab by default', async () => {
    const markup = renderToStaticMarkup(await Page({ searchParams: {} }));

    expect(markup).toContain('Tổng hợp P&amp;L');
    expect(markup).toContain('Tổng hợp theo nguồn');
    // 300 (trading) + 120 (portfolio)
    expect(markup).toContain('+420.00 USDT');
  });

  it('opens the tab named by ?tab=', async () => {
    const trading = renderToStaticMarkup(await Page({ searchParams: { tab: 'trading' } }));
    expect(trading).toContain('Lịch giao dịch');
    expect(trading).toContain('PNL theo cặp giao dịch');

    const portfolio = renderToStaticMarkup(await Page({ searchParams: { tab: 'portfolio' } }));
    expect(portfolio).toContain('Lịch P&amp;L Portfolio');
    expect(portfolio).toContain('All-time Realized P&amp;L');
  });

  // The overview's Total Profit / Loss card sums Bitget + MEXC; this page must
  // fold in the same exchanges, or the same book reads lower here.
  it('counts exchange closed trades in the trading total', async () => {
    mockedCreateApiClient.mockReturnValue({
      fetchOrders: async () => ({
        data: [closedOrder],
        total: 1,
        page: 1,
        pageSize: 1000,
        closedPnlSum: 300,
        openOrders: [],
      }),
      fetchBitgetHistory: async () => ({ trades: [] }),
      fetchMexcHistory: async () => ({ trades: [mexcTrade] }),
      fetchPortfolioPnlCalendar: async () => ({ daily: [], byCoin: [] }),
    } as unknown as ReturnType<typeof createApiClient>);

    const markup = renderToStaticMarkup(await Page({ searchParams: {} }));

    // 300 (manual order) + 50 (MEXC), with no portfolio leg.
    expect(markup).toContain('+350.00 USDT');
  });

  it('falls back to the overview tab for an unknown ?tab=', async () => {
    const markup = renderToStaticMarkup(await Page({ searchParams: { tab: 'nope' } }));

    expect(markup).toContain('Tổng hợp P&amp;L');
  });

  it('still renders when the portfolio calendar fails', async () => {
    mockedCreateApiClient.mockReturnValue({
      fetchOrders: async () => ({
        data: [closedOrder],
        total: 1,
        page: 1,
        pageSize: 1000,
        closedPnlSum: 300,
        openOrders: [],
      }),
      fetchBitgetHistory: async () => ({ trades: [] }),
      fetchMexcHistory: async () => ({ trades: [] }),
      fetchPortfolioPnlCalendar: async () => {
        throw new Error('api down');
      },
    } as unknown as ReturnType<typeof createApiClient>);

    const markup = renderToStaticMarkup(await Page({ searchParams: {} }));

    expect(markup).toContain('Tổng hợp P&amp;L');
    expect(markup).toContain('+300.00 USDT');
  });
});
