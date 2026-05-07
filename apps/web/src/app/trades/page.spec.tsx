import { renderToStaticMarkup } from 'react-dom/server';

import TradesPage from '@web/pages/trades-page/trades-page';
import { createApiClient } from '@web/shared/api/client';

jest.mock('next/headers', () => ({
  headers: jest.fn(() => new Headers({ cookie: 'market_analysis_session=test-token' }))
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/trades',
}));

jest.mock('@web/shared/api/client', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

describe('TradesPage', () => {
  beforeEach(() => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => ({
        data: [
          {
            id: 'order-1',
            symbol: 'BTCUSDT',
            side: 'long',
            status: 'open',
            entryPrice: 68000,
            openedAt: new Date('2026-04-01T08:00:00.000Z'),
            closedAt: null,
            createdAt: new Date('2026-04-01T08:00:00.000Z'),
            updatedAt: new Date('2026-04-01T08:00:00.000Z'),
            closePrice: null,
            pnl: null,
            quantity: 1,
            leverage: 1,
            note: null,
            source: 'manual',
            exchange: null,
            signalId: null
          }
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        closedPnlSum: 0,
        openOrders: [],
      }),
      fetchOrderBrokers: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      fetchDailyAnalysis: async () => [],
      fetchSettings: async () => null,
      upsertSettings: async () => {
        throw new Error('not used');
      },
      createOrder: async () => {
        throw new Error('not used');
      },
      closeOrder: async () => {
        throw new Error('not used');
      }
    } as unknown as ReturnType<typeof createApiClient>);
  });

  it('renders trading history and manual trade entry', async () => {
    const markup = renderToStaticMarkup(await TradesPage({ searchParams: {} }));

    expect(markup).toContain('Trade History');
    expect(markup).toContain('+ Add Trade');
    expect(markup).toContain('BTCUSDT');
  });
});
