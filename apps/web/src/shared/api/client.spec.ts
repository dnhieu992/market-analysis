import { createApiClient, resolveApiBaseUrl } from './client';
import { formatConfidence, formatDateTime, formatPrice } from '@web/shared/lib/format';

describe('dashboard api clients', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    delete process.env.API_BASE_URL;
  });

  it('composes api urls from the configured backend base url', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:4000';

    expect(resolveApiBaseUrl()).toBe('http://localhost:4000');
    expect(resolveApiBaseUrl('/signals')).toBe('http://localhost:4000/signals');
  });

  it('parses orders, signals, analysis runs, and health into typed frontend shapes', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >;
    const client = createApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl
    });

    fetchImpl
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'order-1',
                symbol: 'BTCUSDT',
                side: 'long',
                status: 'open',
                entryPrice: 68000,
                openedAt: '2026-04-01T08:00:00.000Z',
                createdAt: '2026-04-01T08:00:00.000Z',
                updatedAt: '2026-04-01T08:01:00.000Z'
              }
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            closedPnlSum: 0,
            openOrders: []
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'signal-1',
              analysisRunId: 'run-1',
              symbol: 'BTCUSDT',
              timeframe: '4h',
              trend: 'uptrend',
              bias: 'bullish',
              confidence: 82,
              summary: 'Bullish structure remains intact.',
              supportLevelsJson: '[67200,66500]',
              resistanceLevelsJson: '[68800,69500]',
              invalidation: 'Below 66500',
              bullishScenario: 'Break 68800',
              bearishScenario: 'Lose 66500',
              createdAt: '2026-04-01T08:05:00.000Z'
            }
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'run-1',
              symbol: 'BTCUSDT',
              timeframe: '4h',
              candleOpenTime: '2026-04-01T04:00:00.000Z',
              candleCloseTime: '2026-04-01T08:00:00.000Z',
              priceOpen: 67000,
              priceHigh: 68500,
              priceLow: 66800,
              priceClose: 68210,
              rawIndicatorsJson: '{"ema20":68000}',
              llmInputJson: '{"symbol":"BTCUSDT"}',
              llmOutputJson: '{"bias":"bullish"}',
              status: 'completed',
              errorMessage: null,
              createdAt: '2026-04-01T08:05:00.000Z',
              updatedAt: '2026-04-01T08:05:30.000Z'
            }
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ service: 'api', status: 'ok' }), { status: 200 })
      );

    const orders = await client.fetchOrders();
    const signals = await client.fetchSignals();
    const analysisRuns = await client.fetchAnalysisRuns();
    const health = await client.fetchHealth();

    expect(orders.data[0]!).toMatchObject({
      openedAt: expect.any(Date),
      createdAt: expect.any(Date)
    });
    expect(orders.total).toBe(1);
    expect(orders.page).toBe(1);
    expect(orders.closedPnlSum).toBe(0);
    expect(orders.openOrders).toEqual([]);
    expect(signals[0]!).toMatchObject({
      supportLevels: [67200, 66500],
      resistanceLevels: [68800, 69500],
      createdAt: expect.any(Date)
    });
    expect(analysisRuns[0]!).toMatchObject({
      candleCloseTime: expect.any(Date),
      updatedAt: expect.any(Date)
    });
    expect(health).toEqual({ service: 'api', status: 'ok' });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'http://localhost:4000/orders',
      expect.objectContaining({
        credentials: 'include'
      })
    );
  });

  it('formats confidence date and price helpers', () => {
    expect(formatConfidence(82.4)).toBe('82%');
    expect(formatPrice(68000)).toBe('68,000');
    expect(formatDateTime(new Date('2026-04-01T08:00:00.000Z'))).toBe('Apr 1, 2026, 08:00');
  });

  it('forwards configured headers for authenticated server-side requests', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >;
    const client = createApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl,
      headers: {
        cookie: 'market_analysis_session=session-token'
      }
    });

    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [], total: 0, page: 1, pageSize: 20, closedPnlSum: 0, openOrders: [] }),
        { status: 200 }
      )
    );

    await client.fetchOrders();

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:4000/orders',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.any(Headers)
      })
    );
    const requestInit = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(requestInit?.headers).get('cookie')).toBe(
      'market_analysis_session=session-token'
    );
  });
});
