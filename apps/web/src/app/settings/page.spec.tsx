import { renderToStaticMarkup } from 'react-dom/server';

import { createApiClient } from '@web/shared/api/client';
import SettingsPage from './page';

jest.mock('next/headers', () => ({
  headers: jest.fn(() => new Headers({ cookie: 'market_analysis_session=test-token' }))
}));

jest.mock('@web/shared/api/client', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

const mockSettings = {
  id: 'singleton',
  name: 'My Watchlist',
  trackingSymbols: ['BTCUSDT', 'ETHUSDT'],
  createdAt: '2026-04-06T00:00:00.000Z',
  updatedAt: '2026-04-06T00:00:00.000Z'
};

describe('SettingsPage', () => {
  beforeEach(() => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      fetchDailyAnalysis: async () => [],
      login: async () => ({ user: { id: 'user-1', email: 'alice@example.com', name: 'Alice' } }),
      createOrder: async () => { throw new Error('not used'); },
      closeOrder: async () => { throw new Error('not used'); },
      fetchSettings: async () => mockSettings,
      upsertSettings: async () => mockSettings,
      fetchBackTestStrategies: async () => [],
      runBackTest: async () => { throw new Error('not used'); },
      fetchBackTestResults: async () => [],
      fetchBackTestResult: async () => { throw new Error('not used'); },
      deleteBackTestResult: async () => { throw new Error('not used'); }
    } as ReturnType<typeof createApiClient>);
  });

  it('renders the settings page with heading', async () => {
    const markup = renderToStaticMarkup(await SettingsPage());
    expect(markup).toContain('Tracking Settings');
    expect(markup).toContain('Settings');
  });

  it('renders with initial settings data', async () => {
    const markup = renderToStaticMarkup(await SettingsPage());
    expect(markup).toContain('My Watchlist');
    expect(markup).toContain('BTCUSDT');
    expect(markup).toContain('ETHUSDT');
  });

  it('renders empty form when no settings exist', async () => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      fetchDailyAnalysis: async () => [],
      login: async () => ({ user: { id: 'user-1', email: 'alice@example.com', name: 'Alice' } }),
      createOrder: async () => { throw new Error('not used'); },
      closeOrder: async () => { throw new Error('not used'); },
      fetchSettings: async () => null,
      upsertSettings: async () => { throw new Error('not used'); },
      fetchBackTestStrategies: async () => [],
      runBackTest: async () => { throw new Error('not used'); },
      fetchBackTestResults: async () => [],
      fetchBackTestResult: async () => { throw new Error('not used'); },
      deleteBackTestResult: async () => { throw new Error('not used'); }
    } as ReturnType<typeof createApiClient>);

    const markup = renderToStaticMarkup(await SettingsPage());
    expect(markup).toContain('Tracking Settings');
  });
});
