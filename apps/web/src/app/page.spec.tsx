import { renderToStaticMarkup } from 'react-dom/server';

import HomePage from './page';
import { createApiClient } from '@web/shared/api/client';

jest.mock('next/headers', () => ({
  headers: jest.fn(() => new Headers({ cookie: 'market_analysis_session=test-token' }))
}));

jest.mock('@web/shared/api/client', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

describe('HomePage', () => {
  beforeEach(() => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => ({ data: [{ id: 'order-1', symbol: 'BTCUSDT', side: 'long', status: 'open', entryPrice: 68000, openedAt: new Date('2026-04-01T08:00:00.000Z'), closedAt: null, createdAt: new Date('2026-04-01T08:00:00.000Z'), updatedAt: new Date('2026-04-01T08:00:00.000Z'), closePrice: null, pnl: null, quantity: 1, leverage: 1, note: null, source: 'manual', exchange: null, signalId: null }], total: 1, page: 1, pageSize: 20, closedPnlSum: 0, openOrders: [] }),
      fetchSignals: async () => [
        {
          id: 'signal-1',
          analysisRunId: 'run-1',
          symbol: 'BTCUSDT',
          timeframe: '4h',
          trend: 'uptrend',
          bias: 'bullish',
          confidence: 82,
          summary: 'Momentum stays above the trend line.',
          supportLevels: [67200, 66500],
          resistanceLevels: [68800, 69500],
          invalidation: 'Close below 66500',
          bullishScenario: 'Break and hold above 68800',
          bearishScenario: 'Reject at 69500',
          createdAt: new Date('2026-04-01T08:00:00.000Z')
        }
      ],
      fetchAnalysisRuns: async () => [
        {
          id: 'run-1',
          symbol: 'BTCUSDT',
          timeframe: '4h',
          candleOpenTime: new Date('2026-04-01T04:00:00.000Z'),
          candleCloseTime: new Date('2026-04-01T08:00:00.000Z'),
          priceOpen: 67800,
          priceHigh: 68500,
          priceLow: 67550,
          priceClose: 68210,
          rawIndicatorsJson: '{}',
          llmInputJson: '{}',
          llmOutputJson: '{}',
          status: 'completed',
          errorMessage: null,
          createdAt: new Date('2026-04-01T08:01:00.000Z'),
          updatedAt: new Date('2026-04-01T08:01:00.000Z')
        }
      ],
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

  it('renders the overview dashboard structure', async () => {
    const markup = renderToStaticMarkup(await HomePage());

    expect(mockedCreateApiClient).toHaveBeenCalledWith({
      headers: {
        cookie: 'market_analysis_session=test-token'
      }
    });
    expect(markup).toContain('Overview Dashboard');
    expect(markup).toContain('Open Orders');
    expect(markup).toContain('Recent Analysis');
    expect(markup).toContain('Order Activity');
    expect(markup).toContain('/trades');
    expect(markup).toContain('/analysis');
    expect(markup).toContain('BTCUSDT');
  });
});
