import { AnalysisOrchestratorService } from '../src/modules/analysis/analysis-orchestrator.service';
import { PersistenceService } from '../src/modules/persistence/persistence.service';

describe('worker full run smoke', () => {
  it('runs one full analysis cycle against mocked dependencies', async () => {
    const service = new AnalysisOrchestratorService(
      {
        getCandles: jest.fn().mockResolvedValue(
          Array.from({ length: 210 }, (_, index) => ({
            open: 65000 + index,
            high: 65200 + index,
            low: 64800 + index,
            close: 65100 + index,
            volume: 1000 + index,
            openTime: new Date(Date.UTC(2026, 0, 1, index * 4)),
            closeTime: new Date(Date.UTC(2026, 0, 1, index * 4 + 3, 59, 59, 999))
          }))
        )
      } as never,
      {
        analyzeMarket: jest.fn().mockResolvedValue({
          trend: 'uptrend',
          bias: 'bullish',
          confidence: 76,
          summary: 'Dong luc tang van duoc giu.',
          supportLevels: [67000, 66500],
          resistanceLevels: [68800, 69500],
          invalidation: 'Mat 66500.',
          bullishScenario: 'Giu tren 68800.',
          bearishScenario: 'Bi tu choi o 69500.'
        })
      } as never,
      {
        sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 101 })
      } as never,
      new PersistenceService(
        {
          create: jest.fn(async (data) => ({ id: 'run-smoke-1', ...data })),
          findByCandle: jest.fn().mockResolvedValue(null),
          update: jest.fn(async (id: string, data) => ({ id, ...data }))
        } as never,
        {
          create: jest.fn(async (data) => ({ id: 'signal-smoke-1', ...data }))
        } as never
      ),
      { timeframe: '4h' }
    );

    await expect(service.runBatch(['BTCUSDT'])).resolves.toEqual({
      status: 'completed',
      scheduled: ['BTCUSDT'],
      processed: 1,
      skipped: 0,
      failed: 0
    });
  });
});
