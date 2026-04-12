import { formatDailyAnalysisPlanMessage, type Candle } from '@app/core';

import { publishDailyAnalysisPlan } from '../src/modules/analysis/publish-daily-analysis-plan';
import { DailyAnalysisService } from '../src/modules/analysis/daily-analysis.service';

jest.mock('../src/modules/analysis/publish-daily-analysis-plan', () => ({
  publishDailyAnalysisPlan: jest.fn()
}));

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

function makeAnalystDraft() {
  return {
    summary: 'BTCUSDT đang ở vùng chờ breakout.',
    bias: 'Neutral',
    confidence: 42,
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
      trigger: 'H4 close trên 68408.37 kèm volume tăng.',
      entry: 'Chờ breakout xác nhận.',
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
    atrConsistencyCheck: {
      result: 'WARNING',
      details: 'ATR phù hợp breakout nhưng chưa có xác nhận.'
    },
    logicConsistencyCheck: {
      result: 'PASS',
      details: 'Bias và hành động tạm thời còn nhất quán.'
    },
    reasoning: ['D1 bullish nhưng H4 chưa xác nhận breakout.'],
    finalAction: 'Chờ breakout H4 rõ ràng rồi mới vào lệnh.'
  };
}

function makeValidatorResult() {
  return {
    validationResult: 'APPROVED_WITH_ADJUSTMENTS',
    summary: 'Draft hợp lý nhưng cần giữ trạng thái WAIT vì volume yếu.',
    majorIssues: [],
    minorIssues: ['Confidence nên giảm nhẹ do H4 đang conflict với D1.'],
    checks: {
      timeframeConsistency: {
        result: 'WARNING',
        details: 'D1/H4 conflict, nhưng hướng breakout vẫn hợp lý.'
      },
      breakoutLogic: {
        result: 'PASS',
        details: 'Trigger và invalidation logic đúng.'
      },
      riskReward: {
        result: 'PASS',
        details: 'RR đạt mức tối thiểu.'
      },
      atrConsistency: {
        result: 'PASS',
        details: 'ATR phù hợp với breakout swing plan.'
      },
      volumeConfirmation: {
        result: 'WARNING',
        details: 'Volume còn yếu nên chưa nên trade ngay.'
      },
      narrativeVsAction: {
        result: 'PASS',
        details: 'Narrative phù hợp với trạng thái WAIT.'
      },
      structureQuality: {
        result: 'PASS',
        details: 'Cấu trúc đủ rõ cho một breakout watchlist.'
      }
    },
    correctedPlan: {
      summary: 'BTCUSDT đang ở trạng thái chờ breakout xác nhận.',
      bias: 'Neutral',
      confidence: 38,
      status: 'WAIT',
      setupType: 'breakout',
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
      finalAction: 'Đứng ngoài cho tới khi breakout được xác nhận.'
    },
    finalDecisionNote: 'Approved with a WAIT adjustment.'
  };
}

function makePublishedPlan() {
  return {
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
    reasoning: [
      'D1 bullish nhưng H4 chưa xác nhận breakout.',
      'Draft hợp lý nhưng cần giữ trạng thái WAIT vì volume yếu.'
    ],
    atrConsistencyCheck: {
      result: 'WARNING',
      details: 'ATR phù hợp breakout nhưng chưa có xác nhận.'
    },
    logicConsistencyCheck: {
      result: 'PASS',
      details: 'Bias và hành động tạm thời còn nhất quán.'
    }
  };
}

describe('DailyAnalysisService', () => {
  function makeService(
    d1Candles: Candle[],
    h4Candles: Candle[],
    repo?: { findByDate: jest.Mock; create: jest.Mock; listLatest: jest.Mock },
    llmGateway?: { runDailyAnalysisPipeline: jest.Mock }
  ) {
    const getCandles = jest.fn().mockImplementation((_symbol: string, timeframe: string) => {
      return Promise.resolve(timeframe === '1d' ? d1Candles : h4Candles);
    });
    const defaultRepo = {
      findByDate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      listLatest: jest.fn().mockResolvedValue([]),
      listAll: jest.fn().mockResolvedValue([])
    };
    const defaultGatewayResult = {
      provider: 'claude',
      model: 'claude-3-7-sonnet-latest',
      draftPlan: makeAnalystDraft(),
      validatorResult: makeValidatorResult()
    };
    const defaultLlmGateway = {
      runDailyAnalysisPipeline: jest.fn().mockResolvedValue(defaultGatewayResult)
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

  beforeEach(() => {
    (publishDailyAnalysisPlan as jest.Mock).mockReset();
    (publishDailyAnalysisPlan as jest.Mock).mockReturnValue({
      plan: makePublishedPlan(),
      decision: 'PUBLISHED',
      debug: {
        marketData: {},
        analystDraft: makeAnalystDraft(),
        validatorResult: makeValidatorResult(),
        hardCheckResult: { valid: true, issues: [], warnings: [], derivedStatus: 'TRADE_READY' }
      }
    });
  });

  it('fetches D1 candles with limit 200 and H4 candles with limit 200', async () => {
    const getCandles = jest.fn().mockResolvedValue(makeCandles(200, 80000));
    const service = new DailyAnalysisService(
      { getCandles } as never,
      { findByDate: jest.fn().mockResolvedValue(null), create: jest.fn(), listLatest: jest.fn(), listAll: jest.fn().mockResolvedValue([]) },
      {
        runDailyAnalysisPipeline: jest.fn().mockResolvedValue({
          provider: 'claude',
          model: 'claude-3-7-sonnet-latest',
          draftPlan: makeAnalystDraft(),
          validatorResult: makeValidatorResult()
        })
      } as never
    );

    await service.analyze('BTCUSDT');

    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', '1d', 200);
    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', '4h', 200);
  });

  it('analyze returns result with symbol, date, trends, ai output, and summary', async () => {
    const d1Candles = makeCandles(200, 80000);
    const h4Candles = makeCandles(200, 80000);
    const { service } = makeService(d1Candles, h4Candles);
    const result = await service.analyze('BTCUSDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.date).toBeInstanceOf(Date);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.d1.trend);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.h4.trend);
    expect(typeof result.d1.s1).toBe('number');
    expect(typeof result.d1.r1).toBe('number');
    expect(result.marketData.currentPrice).toBe(h4Candles[h4Candles.length - 1]!.close);
    expect(result.marketData.timeframes.D1.ohlcv).toHaveLength(200);
    expect(result.marketData.timeframes.H4.ohlcv).toHaveLength(200);
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
    expect(result.aiOutput.bias).toBe('Neutral');
    expect(result.status).toBe(result.aiOutput.status);
    expect(result.pipelineDebugJson).toBe(
      JSON.stringify({
        marketData: {},
        analystDraft: makeAnalystDraft(),
        validatorResult: makeValidatorResult(),
        hardCheckResult: { valid: true, issues: [], warnings: [], derivedStatus: 'TRADE_READY' }
      })
    );
    expect(result.summary).toBe(
      formatDailyAnalysisPlanMessage({
        symbol: result.symbol,
        date: result.date,
        marketData: result.marketData,
        plan: result.aiOutput
      })
    );
  });

  it('analyzeAndSave saves to repository and returns result', async () => {
    const { service, repo } = makeService(makeCandles(200, 80000), makeCandles(200, 80000));
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
      listLatest: jest.fn(),
      listAll: jest.fn().mockResolvedValue([])
    };
    const { service } = makeService(makeCandles(200, 80000), makeCandles(200, 80000), repo);

    const outcome = await service.analyzeAndSave('BTCUSDT');

    expect(repo.create).not.toHaveBeenCalled();
    expect(outcome.skipped).toBe(true);
  });

  it('passes derived market data to the llm gateway pipeline', async () => {
    const llmGateway = {
      runDailyAnalysisPipeline: jest.fn().mockResolvedValue({
        provider: 'claude',
        model: 'claude-3-7-sonnet-latest',
        draftPlan: makeAnalystDraft(),
        validatorResult: makeValidatorResult()
      })
    };
    const { service } = makeService(makeCandles(200, 80000), makeCandles(200, 80000), undefined, llmGateway);

    await service.analyze('BTCUSDT');

    expect(llmGateway.runDailyAnalysisPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        timeframes: expect.objectContaining({
          D1: expect.objectContaining({ trend: expect.any(String) }),
          H4: expect.objectContaining({ trend: expect.any(String) })
        })
      })
    );
  });

  it('persists provider metadata, raw ai output, and derived summary', async () => {
    const { service, repo } = makeService(makeCandles(200, 80000), makeCandles(200, 80000));

    const outcome = await service.analyzeAndSave('BTCUSDT');
    const expectedSummary = outcome.result.summary;

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'WAIT',
        llmProvider: 'claude',
        llmModel: 'claude-3-7-sonnet-latest',
        aiOutputJson: JSON.stringify(makePublishedPlan()),
        pipelineDebugJson: JSON.stringify({
          marketData: {},
          analystDraft: makeAnalystDraft(),
          validatorResult: makeValidatorResult(),
          hardCheckResult: { valid: true, issues: [], warnings: [], derivedStatus: 'TRADE_READY' }
        }),
        summary: expectedSummary
      })
    );
    expect(outcome.result.summary).toBe(expectedSummary);
  });
});
