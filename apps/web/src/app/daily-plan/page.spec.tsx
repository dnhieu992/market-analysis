import { renderToStaticMarkup } from 'react-dom/server';

import { createApiClient } from '@web/shared/api/client';
import DailyPlanPage from './page';

jest.mock('@web/shared/api/client', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

const mockRecord = {
  id: 'daily-1',
  symbol: 'BTCUSDT',
  date: '2026-04-05T00:00:00.000Z',
  d1Trend: 'bullish' as const,
  h4Trend: 'bearish' as const,
  d1S1: 81000,
  d1S2: 78500,
  d1R1: 85200,
  d1R2: 88500,
  h4S1: 82000,
  h4S2: 80400,
  h4R1: 83200,
  h4R2: 84100,
  summary: '📅 BTCUSDT Daily Plan — 2026-04-05',
  createdAt: '2026-04-05T00:01:00.000Z'
};

describe('DailyPlanPage', () => {
  beforeEach(() => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      fetchDailyAnalysis: async () => [mockRecord],
      createOrder: async () => { throw new Error('not used'); },
      closeOrder: async () => { throw new Error('not used'); }
    } as ReturnType<typeof createApiClient>);
  });

  it('renders the daily plan page with BTC header', async () => {
    const markup = renderToStaticMarkup(await DailyPlanPage());
    expect(markup).toContain('BTC Daily Analysis');
    expect(markup).toContain('Daily Plan');
  });

  it('renders a card with trend and level data', async () => {
    const markup = renderToStaticMarkup(await DailyPlanPage());
    expect(markup).toContain('BTCUSDT');
    expect(markup).toContain('Bullish');
    expect(markup).toContain('Bearish');
    expect(markup).toContain('81,000');
    expect(markup).toContain('85,200');
  });

  it('shows empty state when no records', async () => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      fetchDailyAnalysis: async () => [],
      createOrder: async () => { throw new Error('not used'); },
      closeOrder: async () => { throw new Error('not used'); }
    } as ReturnType<typeof createApiClient>);

    const markup = renderToStaticMarkup(await DailyPlanPage());
    expect(markup).toContain('No daily plans yet');
  });
});
