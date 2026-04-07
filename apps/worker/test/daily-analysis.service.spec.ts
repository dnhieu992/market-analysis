import type { Candle } from '@app/core';

import { DailyAnalysisService } from '../src/modules/analysis/daily-analysis.service';

function makeCandles(count: number, base: number, descending = false): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const offset = descending ? (count - i) * 10 : i * 10;
    return {
      open: base + offset,
      high: base + offset + (i % 3 === 1 ? 200 : 50),
      low: base + offset - (i % 3 === 0 ? 200 : 20),
      close: base + offset + 5,
      volume: 1000,
      openTime: new Date(Date.UTC(2026, 0, i + 1)),
      closeTime: new Date(Date.UTC(2026, 0, i + 1, 23, 59))
    };
  });
}

describe('DailyAnalysisService', () => {
  function makeService(
    d1Candles: Candle[],
    h4Candles: Candle[],
    repo?: { findByDate: jest.Mock; create: jest.Mock; listLatest: jest.Mock },
    llmGateway?: { generateDailyAnalysisPlan: jest.Mock }
  ) {
    const getCandles = jest.fn().mockImplementation((_symbol: string, timeframe: string) => {
      return Promise.resolve(timeframe === '1d' ? d1Candles : h4Candles);
    });
    const defaultRepo = {
      findByDate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      listLatest: jest.fn().mockResolvedValue([])
    };
    const defaultGatewayResult = {
      provider: 'claude',
      model: 'claude-3-7-sonnet-latest',
      plan: {
        analysis: 'BTC dang giu xu huong tang trong ngay.',
        bias: 'bullish',
        confidence: 78,
        tradePlan: {
          entryZone: 'Canh mua 82,000-82,400.',
          stopLoss: 'Dung lo duoi 80,500.',
          takeProfit: 'Chot loi tai 84,200 va 85,500.',
          invalidation: 'Mat 80,500.'
        },
        scenarios: {
          bullishScenario: 'Giu 82,000 thi co the len 84,200.',
          bearishScenario: 'Mat 82,000 thi de lui ve 80,500.'
        },
        riskNote: 'Khong duoi gia.',
        timeHorizon: 'intraday to 1 day'
      }
    };
    const defaultLlmGateway = {
      generateDailyAnalysisPlan: jest.fn().mockResolvedValue(defaultGatewayResult)
    };
    return {
      service: new DailyAnalysisService(
        { getCandles } as never,
        repo ?? defaultRepo,
        (llmGateway ?? defaultLlmGateway) as never
      ),
      repo: repo ?? defaultRepo,
      llmGateway: llmGateway ?? defaultLlmGateway,
      gatewayResult: defaultGatewayResult
    };
  }

  it('fetches D1 candles with limit 100 and H4 candles with limit 100', async () => {
    const getCandles = jest.fn().mockResolvedValue(makeCandles(100, 80000));
    const service = new DailyAnalysisService(
      { getCandles } as never,
      { findByDate: jest.fn().mockResolvedValue(null), create: jest.fn(), listLatest: jest.fn() },
      {
        generateDailyAnalysisPlan: jest.fn().mockResolvedValue({
          provider: 'claude',
          model: 'claude-3-7-sonnet-latest',
          plan: {
            analysis: 'BTC dang giu xu huong tang trong ngay.',
            bias: 'bullish',
            confidence: 78,
            tradePlan: {
              entryZone: 'Canh mua 82,000-82,400.',
              stopLoss: 'Dung lo duoi 80,500.',
              takeProfit: 'Chot loi tai 84,200 va 85,500.',
              invalidation: 'Mat 80,500.'
            },
            scenarios: {
              bullishScenario: 'Giu 82,000 thi co the len 84,200.',
              bearishScenario: 'Mat 82,000 thi de lui ve 80,500.'
            },
            riskNote: 'Khong duoi gia.',
            timeHorizon: 'intraday to 1 day'
          }
        })
      } as never
    );

    await service.analyze('BTCUSDT');

    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', '1d', 100);
    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', '4h', 100);
  });

  it('analyze returns result with symbol, date, trends, ai output, and summary', async () => {
    const { service } = makeService(makeCandles(20, 80000), makeCandles(100, 80000));
    const result = await service.analyze('BTCUSDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.date).toBeInstanceOf(Date);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.d1.trend);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.h4.trend);
    expect(typeof result.d1.s1).toBe('number');
    expect(typeof result.d1.r1).toBe('number');
    expect(result.h4Indicators).toEqual(
      expect.objectContaining({
        ema20: expect.any(Number),
        ema50: expect.any(Number),
        ema200: expect.any(Number),
        rsi14: expect.any(Number),
        macd: expect.objectContaining({
          macd: expect.any(Number),
          signal: expect.any(Number),
          histogram: expect.any(Number)
        }),
        atr14: expect.any(Number),
        volumeRatio: expect.any(Number)
      })
    );
    expect(typeof result.summary).toBe('string');
    expect(result.llmProvider).toBe('claude');
    expect(result.llmModel).toBe('claude-3-7-sonnet-latest');
    expect(result.aiOutput.bias).toBe('bullish');
  });

  it('analyzeAndSave saves to repository and returns result', async () => {
    const { service, repo } = makeService(makeCandles(20, 80000), makeCandles(100, 80000));
    const outcome = await service.analyzeAndSave('BTCUSDT');

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(outcome.skipped).toBe(false);
    expect(outcome.result.symbol).toBe('BTCUSDT');
  });

  it('analyzeAndSave skips when record already exists for today', async () => {
    const existingRecord = { id: 'existing', symbol: 'BTCUSDT' };
    const repo = {
      findByDate: jest.fn().mockResolvedValue(existingRecord),
      create: jest.fn(),
      listLatest: jest.fn()
    };
    const { service } = makeService(makeCandles(20, 80000), makeCandles(100, 80000), repo);

    const outcome = await service.analyzeAndSave('BTCUSDT');

    expect(repo.create).not.toHaveBeenCalled();
    expect(outcome.skipped).toBe(true);
  });

  it('passes derived market structure to the llm gateway', async () => {
    const llmGateway = {
      generateDailyAnalysisPlan: jest.fn().mockResolvedValue({
        provider: 'claude',
        model: 'claude-3-7-sonnet-latest',
        plan: {
          analysis: 'BTC dang giu xu huong tang trong ngay.',
          bias: 'bullish',
          confidence: 78,
          tradePlan: {
            entryZone: 'Canh mua 82,000-82,400.',
            stopLoss: 'Dung lo duoi 80,500.',
            takeProfit: 'Chot loi tai 84,200 va 85,500.',
            invalidation: 'Mat 80,500.'
          },
          scenarios: {
            bullishScenario: 'Giu 82,000 thi co the len 84,200.',
            bearishScenario: 'Mat 82,000 thi de lui ve 80,500.'
          },
          riskNote: 'Khong duoi gia.',
          timeHorizon: 'intraday to 1 day'
        }
      })
    };
    const { service } = makeService(makeCandles(20, 80000), makeCandles(100, 80000), undefined, llmGateway);

    await service.analyze('BTCUSDT');

    expect(llmGateway.generateDailyAnalysisPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        d1: expect.objectContaining({ trend: expect.any(String) }),
        h4: expect.objectContaining({ trend: expect.any(String) }),
        h4Indicators: expect.objectContaining({
          ema20: expect.any(Number),
          ema50: expect.any(Number),
          ema200: expect.any(Number),
          rsi14: expect.any(Number),
          macd: expect.objectContaining({
            macd: expect.any(Number),
            signal: expect.any(Number),
            histogram: expect.any(Number)
          }),
          atr14: expect.any(Number),
          volumeRatio: expect.any(Number)
        })
      })
    );
  });

  it('persists provider metadata, raw ai output, and derived summary', async () => {
    const { service, repo, gatewayResult } = makeService(makeCandles(20, 80000), makeCandles(100, 80000));

    const outcome = await service.analyzeAndSave('BTCUSDT');

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        llmProvider: 'claude',
        llmModel: 'claude-3-7-sonnet-latest',
        aiOutputJson: JSON.stringify(gatewayResult.plan),
        summary: expect.stringContaining('1) Tóm tắt nhanh')
      })
    );
    expect(outcome.result.summary).toContain('4) Kế hoạch giao dịch chính');
  });
});
