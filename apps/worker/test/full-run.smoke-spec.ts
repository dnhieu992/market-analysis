import { AnalysisOrchestratorService } from '../src/modules/analysis/analysis-orchestrator.service';

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
        sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 101 })
      } as never,
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
