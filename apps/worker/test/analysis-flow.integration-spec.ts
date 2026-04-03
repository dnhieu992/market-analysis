import type { Candle } from '@app/core';

import { AnalysisOrchestratorService } from '../src/modules/analysis/analysis-orchestrator.service';

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

  it('sends a candle-signal message even when telegram returns a non-success response', async () => {
    const telegramService = {
      sendAnalysisMessage: jest.fn().mockResolvedValue({ success: false })
    };

    const service = new AnalysisOrchestratorService(
      {
        getCandles: jest.fn().mockResolvedValue(candles)
      } as never,
      telegramService as never,
      { timeframe: '4h' }
    );

    const result = await service.runBatch(['BTCUSDT']);

    expect(result.processed).toBe(1);
    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledTimes(1);
    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'candle-signal' })
    );
  });
});
