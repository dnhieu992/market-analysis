import type { Candle } from '@app/core';

import { AnalysisOrchestratorService } from '../src/modules/analysis/analysis-orchestrator.service';

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

  it('sends a candle-signal message and reports processed for one symbol', async () => {
    const telegramService = {
      sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 123 })
    };
    const service = new AnalysisOrchestratorService(
      {
        getCandles: jest.fn().mockResolvedValue([...candles, latestClosedCandle])
      } as never,
      telegramService as never,
      { timeframe: '4h' }
    );

    const result = await service.runBatch(['BTCUSDT']);

    expect(result).toEqual({
      status: 'completed',
      scheduled: ['BTCUSDT'],
      processed: 1,
      skipped: 0,
      failed: 0
    });
    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledTimes(1);
    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'candle-signal' })
    );
  });

  it('skips duplicate candles using in-memory deduplication', async () => {
    const telegramService = {
      sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 321 })
    };
    const service = new AnalysisOrchestratorService(
      {
        getCandles: jest.fn().mockResolvedValue([...candles, latestClosedCandle])
      } as never,
      telegramService as never,
      { timeframe: '4h' }
    );

    await service.runBatch(['BTCUSDT']);
    const result = await service.runBatch(['BTCUSDT']);

    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'completed',
      scheduled: ['BTCUSDT'],
      processed: 0,
      skipped: 1,
      failed: 0
    });
  });

  it('counts a symbol as failed without crashing the batch when market data errors', async () => {
    const marketDataService = {
      getCandles: jest
        .fn()
        .mockImplementation(async (symbol: string) =>
          symbol === 'ETHUSDT'
            ? Promise.reject(new Error('market offline'))
            : [...candles, latestClosedCandle]
        )
    };
    const telegramService = {
      sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 999 })
    };
    const service = new AnalysisOrchestratorService(
      marketDataService as never,
      telegramService as never,
      { timeframe: '4h' }
    );

    const result = await service.runBatch(['BTCUSDT', 'ETHUSDT']);

    expect(result).toEqual({
      status: 'completed',
      scheduled: ['BTCUSDT', 'ETHUSDT'],
      processed: 1,
      skipped: 0,
      failed: 1
    });
  });
});
