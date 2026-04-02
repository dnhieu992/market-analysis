import type { Candle, LlmSignal } from '@app/core';

import { AnalysisOrchestratorService } from '../src/modules/analysis/analysis-orchestrator.service';
import { PersistenceService } from '../src/modules/persistence/persistence.service';

function createPersistenceService() {
  const analysisRuns: Array<Record<string, unknown>> = [];
  const signals: Array<Record<string, unknown>> = [];

  const persistence = new PersistenceService(
    {
      create: jest.fn(async (data) => {
        const record = {
          id: `run-${analysisRuns.length + 1}`,
          ...data
        };
        analysisRuns.push(record);
        return record;
      }),
      findByCandle: jest.fn(async (symbol: string, timeframe: string, candleCloseTime: Date) => {
        return (
          analysisRuns.find(
            (run) =>
              run.symbol === symbol &&
              run.timeframe === timeframe &&
              String(run.candleCloseTime) === String(candleCloseTime)
          ) ?? null
        );
      }),
      update: jest.fn(async (id: string, data) => {
        const run = analysisRuns.find((entry) => entry.id === id);
        Object.assign(run ?? {}, data);
        return run;
      })
    } as never,
    {
      create: jest.fn(async (data) => {
        const record = {
          id: `signal-${signals.length + 1}`,
          ...data
        };
        signals.push(record);
        return record;
      })
    } as never
  );

  return { persistence, analysisRuns, signals };
}

describe('analysis orchestrator', () => {
  const latestClosedCandle: Candle = {
    open: 67000,
    high: 68500,
    low: 66800,
    close: 68210,
    volume: 1234,
    openTime: new Date('2026-04-01T04:00:00.000Z'),
    closeTime: new Date('2026-04-01T08:00:00.000Z')
  };

  const candles: Candle[] = Array.from({ length: 210 }, (_, index) => ({
    open: 65000 + index,
    high: 65200 + index,
    low: 64800 + index,
    close: 65100 + index,
    volume: 1000 + index,
    openTime: new Date(Date.UTC(2026, 0, 1, index * 4)),
    closeTime: new Date(Date.UTC(2026, 0, 1, index * 4 + 3, 59, 59, 999))
  }));

  const llmSignal: LlmSignal = {
    trend: 'uptrend',
    bias: 'bullish',
    confidence: 78,
    summary: 'Dong luc tang duoc duy tri.',
    supportLevels: [67200, 66500],
    resistanceLevels: [68800, 69500],
    invalidation: 'Dong cua duoi 66500.',
    bullishScenario: 'Giu tren 68800.',
    bearishScenario: 'Bi tu choi manh o 69500.'
  };

  it('creates an analysis run, signal, and telegram log for one symbol', async () => {
    const { persistence, analysisRuns, signals } = createPersistenceService();
    const telegramService = {
      sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 123 })
    };
    const service = new AnalysisOrchestratorService(
      {
        getCandles: jest.fn().mockResolvedValue([...candles, latestClosedCandle])
      } as never,
      {
        analyzeMarket: jest.fn().mockResolvedValue(llmSignal)
      } as never,
      telegramService as never,
      persistence,
      { timeframe: '4h' } as never
    );

    const result = await service.runBatch(['BTCUSDT']);

    expect(result).toEqual({
      status: 'completed',
      scheduled: ['BTCUSDT'],
      processed: 1,
      skipped: 0,
      failed: 0
    });
    expect(analysisRuns).toHaveLength(1);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual(
      expect.objectContaining({
        analysisRunId: 'run-1',
        symbol: 'BTCUSDT',
        timeframe: '4h'
      })
    );
    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledTimes(1);
  });

  it('skips duplicate candles without creating another analysis run', async () => {
    const { persistence, analysisRuns } = createPersistenceService();
    const service = new AnalysisOrchestratorService(
      {
        getCandles: jest.fn().mockResolvedValue([...candles, latestClosedCandle])
      } as never,
      {
        analyzeMarket: jest.fn().mockResolvedValue(llmSignal)
      } as never,
      {
        sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 321 })
      } as never,
      persistence,
      { timeframe: '4h' } as never
    );

    await service.runBatch(['BTCUSDT']);
    const result = await service.runBatch(['BTCUSDT']);

    expect(analysisRuns).toHaveLength(1);
    expect(result).toEqual({
      status: 'completed',
      scheduled: ['BTCUSDT'],
      processed: 0,
      skipped: 1,
      failed: 0
    });
  });

  it('records a failed run when one symbol errors without crashing the batch', async () => {
    const { persistence, analysisRuns } = createPersistenceService();
    const marketDataService = {
      getCandles: jest
        .fn()
        .mockImplementation(async (symbol: string) =>
          symbol === 'ETHUSDT' ? Promise.reject(new Error('market offline')) : [...candles, latestClosedCandle]
        )
    };
    const service = new AnalysisOrchestratorService(
      marketDataService as never,
      {
        analyzeMarket: jest.fn().mockResolvedValue(llmSignal)
      } as never,
      {
        sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 999 })
      } as never,
      persistence,
      { timeframe: '4h' } as never
    );

    const result = await service.runBatch(['BTCUSDT', 'ETHUSDT']);

    expect(result).toEqual({
      status: 'completed',
      scheduled: ['BTCUSDT', 'ETHUSDT'],
      processed: 1,
      skipped: 0,
      failed: 1
    });
    expect(analysisRuns).toHaveLength(2);
    expect(analysisRuns[1]).toEqual(
      expect.objectContaining({
        symbol: 'ETHUSDT',
        status: 'failed',
        errorMessage: 'market offline'
      })
    );
  });
});
