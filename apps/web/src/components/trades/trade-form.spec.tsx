import { renderToStaticMarkup } from 'react-dom/server';

import { parseCreateOrderFormData, submitManualOrder } from '../../app/trades/actions';
import { TradeForm } from './trade-form';
import { createApiClient } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

describe('TradeForm', () => {
  it('renders the required manual trade fields', () => {
    const markup = renderToStaticMarkup(<TradeForm />);

    expect(markup).toContain('Add Manual Trade');
    expect(markup).toContain('Symbol');
    expect(markup).toContain('Side');
    expect(markup).toContain('Entry Price');
    expect(markup).toContain('Submit Trade');
  });

  it('validates required order fields', () => {
    expect(() => parseCreateOrderFormData(new FormData())).toThrow('Symbol is required');
  });

  it('submits a manual order through the API client', async () => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      createOrder: async () => ({
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
      }),
      closeOrder: async () => {
        throw new Error('not used');
      }
    });

    const result = await submitManualOrder({
      symbol: 'BTCUSDT',
      side: 'long',
      entryPrice: '68000',
      quantity: '1'
    });

    expect(result.id).toBe('order-1');
    expect(mockedCreateApiClient).toHaveBeenCalled();
  });
});
