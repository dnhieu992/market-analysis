import { renderToStaticMarkup } from 'react-dom/server';

import { createApiClient } from '@web/shared/api/client';
import AnalysisPage from './page';

jest.mock('next/headers', () => ({
  headers: jest.fn(() => new Headers({ cookie: 'market_analysis_session=test-token' }))
}));

jest.mock('@web/shared/api/client', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

describe('AnalysisPage', () => {
  beforeEach(() => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [
        {
          id: 'signal-1',
          analysisRunId: 'run-1',
          symbol: 'BTCUSDT',
          timeframe: '4h',
          trend: 'uptrend',
          bias: 'bullish',
          confidence: 84,
          summary: 'Momentum stays above support.',
          supportLevels: [67200, 66500],
          resistanceLevels: [68800, 69500],
          invalidation: 'Close below 66500',
          bullishScenario: 'Hold above 68800',
          bearishScenario: 'Reject at 69500',
          createdAt: new Date('2026-04-01T08:00:00.000Z')
        },
        {
          id: 'signal-2',
          analysisRunId: 'run-2',
          symbol: 'ETHUSDT',
          timeframe: '4h',
          trend: 'sideways',
          bias: 'neutral',
          confidence: 59,
          summary: 'Price is compressing near support.',
          supportLevels: [3200, 3150],
          resistanceLevels: [3350, 3420],
          invalidation: 'Close above 3420',
          bullishScenario: 'Break 3350 with volume',
          bearishScenario: 'Lose 3150 support',
          createdAt: new Date('2026-04-01T12:00:00.000Z')
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
          rawIndicatorsJson: '{"ema20":68000}',
          llmInputJson: '{"symbol":"BTCUSDT"}',
          llmOutputJson: '{"trend":"uptrend"}',
          status: 'completed',
          errorMessage: null,
          createdAt: new Date('2026-04-01T08:01:00.000Z'),
          updatedAt: new Date('2026-04-01T08:01:00.000Z')
        },
        {
          id: 'run-2',
          symbol: 'ETHUSDT',
          timeframe: '4h',
          candleOpenTime: new Date('2026-04-01T08:00:00.000Z'),
          candleCloseTime: new Date('2026-04-01T12:00:00.000Z'),
          priceOpen: 3300,
          priceHigh: 3380,
          priceLow: 3180,
          priceClose: 3250,
          rawIndicatorsJson: '{"ema20":3280}',
          llmInputJson: '{"symbol":"ETHUSDT"}',
          llmOutputJson: '{"trend":"sideways"}',
          status: 'completed',
          errorMessage: null,
          createdAt: new Date('2026-04-01T12:01:00.000Z'),
          updatedAt: new Date('2026-04-01T12:01:00.000Z')
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

  it('renders signal cards with structured analysis data', async () => {
    const markup = renderToStaticMarkup(await AnalysisPage({ searchParams: {} }));

    expect(markup).toContain('Structured Analysis Feed');
    expect(markup).toContain('BTCUSDT');
    expect(markup).toContain('ETHUSDT');
    expect(markup).toContain('Trend');
    expect(markup).toContain('Bias');
    expect(markup).toContain('Confidence');
    expect(markup).toContain('Support');
    expect(markup).toContain('Resistance');
  });

  it('opens detail state for a selected analysis run', async () => {
    const markup = renderToStaticMarkup(
      await AnalysisPage({ searchParams: { signal: 'signal-2' } })
    );

    expect(markup).toContain('Selected Analysis');
    expect(markup).toContain('ETHUSDT');
    expect(markup).toContain('Candle close');
    expect(markup).toContain('Run status');
    expect(markup).toContain('Price close');
    expect(markup).toContain('Confidence');
  });
});
