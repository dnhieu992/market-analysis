import type { Candle, LlmSignal } from '@app/core';

import { AnalysisOrchestratorService } from '../src/modules/analysis/analysis-orchestrator.service';
import { PersistenceService } from '../src/modules/persistence/persistence.service';

describe('analysis flow integration', () => {
  const candles: Candle[] = Array.from({ length: 210 }, (_, index) => ({
    open: 65000 + index,
    high: 65200 + index,
    low: 64800 + index,
    close: 65100 + index,
    volume: 1200 + index,
    openTime: new Date(Date.UTC(2026, 0, 1, index * 4)),
    closeTime: new Date(Date.UTC(2026, 0, 1, index * 4 + 3, 59, 59, 999))
  }));

  const latestClosedCandle = candles[candles.length - 1]!;

  const signal: LlmSignal = {
    trend: 'sideways',
    bias: 'neutral',
    confidence: 55,
    summary: 'Gia dang tich luy.',
    supportLevels: [66000],
    resistanceLevels: [68000],
    invalidation: 'Mat 66000.',
    bullishScenario: 'Vuot 68000.',
    bearishScenario: 'Bi tu choi o 68000.'
  };

  it('keeps a successful analysis run even when telegram delivery fails', async () => {
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
        findByCandle: jest.fn().mockResolvedValue(null),
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

    const service = new AnalysisOrchestratorService(
      {
        getCandles: jest.fn().mockResolvedValue(candles)
      } as never,
      {
        analyzeMarket: jest.fn().mockResolvedValue(signal)
      } as never,
      {
        sendAnalysisMessage: jest.fn().mockResolvedValue({ success: false })
      } as never,
      persistence,
      { timeframe: '4h' } as never
    );

    const result = await service.runBatch(['BTCUSDT']);

    expect(result.processed).toBe(1);
    expect(analysisRuns[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
        candleCloseTime: latestClosedCandle.closeTime
      })
    );
    expect(signals).toHaveLength(1);
  });
});
