import { renderToStaticMarkup } from 'react-dom/server';

import { createApiClient } from '@web/shared/api/client';

import { CloseTradeForm } from './close-trade-form';
import { parseCloseOrderFormData, submitCloseOrder } from './close-trade.model';

jest.mock('@web/shared/api/client', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

describe('CloseTradeForm', () => {
  it('renders a close action for open trades', () => {
    const markup = renderToStaticMarkup(
      <CloseTradeForm orderId="order-1" status="open" onSubmitted={jest.fn()} />
    );

    expect(markup).toContain('Close Trade');
    expect(markup).toContain('Close Price');
  });

  it('hides the close action for closed trades', () => {
    const markup = renderToStaticMarkup(
      <CloseTradeForm orderId="order-1" status="closed" onSubmitted={jest.fn()} />
    );

    expect(markup).not.toContain('Close Trade');
  });

  it('validates required close fields', () => {
    expect(() => parseCloseOrderFormData(new FormData())).toThrow('Close price is required');
  });

  it('submits the close trade mutation and triggers refresh handling', async () => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      createOrder: async () => {
        throw new Error('not used');
      },
      closeOrder: async () => ({
        id: 'order-1',
        symbol: 'BTCUSDT',
        side: 'long',
        status: 'closed',
        entryPrice: 68000,
        openedAt: new Date('2026-04-01T08:00:00.000Z'),
        closedAt: new Date('2026-04-01T10:00:00.000Z'),
        createdAt: new Date('2026-04-01T08:00:00.000Z'),
        updatedAt: new Date('2026-04-01T10:00:00.000Z'),
        closePrice: 69000,
        pnl: 1000,
        quantity: 1,
        leverage: 1,
        note: null,
        source: 'manual',
        exchange: null,
        signalId: null
      })
    });

    const result = await submitCloseOrder('order-1', {
      closePrice: '69000'
    });

    expect(result.status).toBe('closed');
    expect(mockedCreateApiClient).toHaveBeenCalled();
  });
});
