import { renderToStaticMarkup } from 'react-dom/server';

import TradesPage from './page';
import { createApiClient } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

describe('TradesPage', () => {
  beforeEach(() => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [
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
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      createOrder: async () => {
        throw new Error('not used');
      },
      closeOrder: async () => {
        throw new Error('not used');
      }
    });
  });

  it('renders trading history and manual trade entry', async () => {
    const markup = renderToStaticMarkup(await TradesPage());

    expect(markup).toContain('Trading History');
    expect(markup).toContain('Add Manual Trade');
    expect(markup).toContain('BTCUSDT');
    expect(markup).toContain('Open trading history');
  });
});
