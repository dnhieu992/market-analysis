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
          JSON.stringify([
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
          ]),
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

    expect(orders[0]!).toMatchObject({
      openedAt: expect.any(Date),
      createdAt: expect.any(Date)
    });
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
  });

  it('parses richer daily analysis plans and status fields', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >;
    const client = createApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl
    });

    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'daily-1',
            symbol: 'BTCUSDT',
            date: '2026-04-05T00:00:00.000Z',
            status: 'WAIT',
            d1Trend: 'bullish',
            h4Trend: 'bearish',
            d1S1: 81000,
            d1S2: 78500,
            d1R1: 85200,
            d1R2: 88500,
            h4S1: 82000,
            h4S2: 80400,
            h4R1: 83200,
            h4R2: 84100,
            llmProvider: 'claude',
            llmModel: 'claude-sonnet-4-20250514',
            pipelineDebugJson: '{"hardCheckResult":{"valid":true}}',
            summary: 'BTCUSDT đang ở trạng thái chờ breakout xác nhận.',
            aiOutputJson: JSON.stringify({
              summary: 'BTCUSDT đang ở trạng thái chờ breakout xác nhận.',
              bias: 'Neutral',
              confidence: 38,
              status: 'WAIT',
              timeframeContext: {
                biasFrame: 'D1',
                setupFrame: 'H4',
                entryRefinementFrame: 'none',
                higherTimeframeView: 'D1 bullish nhưng H4 chưa confirm.',
                setupTimeframeView: 'H4 đang bearish và cần xác nhận.',
                alignment: 'conflicting'
              },
              marketState: {
                trendCondition: 'compressed',
                volumeCondition: 'very_weak',
                volatilityCondition: 'normal',
                keyObservation: 'Giá nén chặt, volume yếu, chưa có kèo đẹp.'
              },
              setupType: 'breakout',
              noTradeZone: 'Tránh vào khi H4 còn nằm trong biên nén.',
              primarySetup: {
                direction: 'long',
                trigger: 'H4 close trên 68408.37 kèm volume tốt.',
                entry: 'Chờ xác nhận rồi mới cân nhắc vào.',
                stopLoss: 'Dưới 68153.',
                takeProfit1: '68698.7',
                takeProfit2: '69310',
                riskReward: '1:2',
                invalidation: 'H4 close dưới 68153.'
              },
              secondarySetup: {
                direction: 'none',
                trigger: 'Chưa có setup phụ.',
                entry: 'Đứng ngoài.',
                stopLoss: 'N/A',
                takeProfit1: 'N/A',
                takeProfit2: 'N/A',
                riskReward: 'N/A',
                invalidation: 'N/A'
              },
              finalAction: 'Đứng ngoài cho tới khi breakout được xác nhận.',
              reasoning: ['D1 bullish nhưng H4 chưa xác nhận breakout.'],
              atrConsistencyCheck: {
                result: 'WARNING',
                details: 'ATR phù hợp breakout nhưng chưa có xác nhận.'
              },
              logicConsistencyCheck: {
                result: 'PASS',
                details: 'Bias và hành động tạm thời còn nhất quán.'
              }
            }),
            createdAt: '2026-04-05T00:01:00.000Z'
          }
        ]),
        { status: 200 }
      )
    );

    const records = await client.fetchDailyAnalysis('BTCUSDT');

    expect(records[0]!).toMatchObject({
      status: 'WAIT',
      pipelineDebugJson: '{"hardCheckResult":{"valid":true}}',
      aiOutput: expect.objectContaining({
        bias: 'Neutral',
        status: 'WAIT'
      })
    });
  });

  it('formats confidence date and price helpers', () => {
    expect(formatConfidence(82.4)).toBe('82%');
    expect(formatPrice(68000)).toBe('68,000');
    expect(formatDateTime(new Date('2026-04-01T08:00:00.000Z'))).toBe('Apr 1, 2026, 08:00');
  });
});
