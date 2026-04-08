import type { Candle } from '@app/core';

import { MarketSummaryService } from '../src/modules/market-summary/market-summary.service';

function buildCandles(closeTimes: string[]): Candle[] {
  return closeTimes.map((closeTime, index) => ({
    open: 100 + index,
    high: 102 + (index % 2 === 0 ? 4 : 1),
    low: 98 - (index % 2 === 0 ? 1 : 4),
    close: 101 + index,
    volume: 100 + index * 10,
    closeTime: new Date(closeTime)
  }));
}

describe('MarketSummaryService', () => {
  const originalTrackedSymbols = process.env.TRACKED_SYMBOLS;

  afterEach(() => {
    if (originalTrackedSymbols === undefined) {
      delete process.env.TRACKED_SYMBOLS;
    } else {
      process.env.TRACKED_SYMBOLS = originalTrackedSymbols;
    }
  });

  it('does not expose a startup hook that sends summaries on app bootstrap', () => {
    const service = new MarketSummaryService(
      { getCandles: jest.fn() } as never,
      { sendAnalysisMessage: jest.fn() } as never
    );

    expect('onModuleInit' in service).toBe(false);
  });

  it('can still send summaries when the cron handler runs', async () => {
    process.env.TRACKED_SYMBOLS = 'BTCUSDT';

    const recentH4Candles = buildCandles(['2026-04-07T04:00:00.000Z', '2026-04-07T08:00:00.000Z']);
    const d1Candles = buildCandles([
      '2026-04-03T00:00:00.000Z',
      '2026-04-04T00:00:00.000Z',
      '2026-04-05T00:00:00.000Z',
      '2026-04-06T00:00:00.000Z',
      '2026-04-07T00:00:00.000Z'
    ]);
    const h4Candles = buildCandles([
      '2026-04-06T08:00:00.000Z',
      '2026-04-06T12:00:00.000Z',
      '2026-04-06T16:00:00.000Z',
      '2026-04-06T20:00:00.000Z',
      '2026-04-07T00:00:00.000Z'
    ]);
    const h1Candles = buildCandles([
      '2026-04-07T00:00:00.000Z',
      '2026-04-07T01:00:00.000Z',
      '2026-04-07T02:00:00.000Z',
      '2026-04-07T03:00:00.000Z',
      '2026-04-07T04:00:00.000Z'
    ]);

    const getCandles = jest.fn().mockImplementation((_symbol: string, timeframe: string, limit: number) => {
      if (timeframe === '4h' && limit === 2) {
        return Promise.resolve(recentH4Candles);
      }

      if (timeframe === '1d') {
        return Promise.resolve(d1Candles);
      }

      if (timeframe === '4h') {
        return Promise.resolve(h4Candles);
      }

      if (timeframe === '1h') {
        return Promise.resolve(h1Candles);
      }

      return Promise.resolve([]);
    });
    const sendAnalysisMessage = jest.fn().mockResolvedValue({ success: true });

    const service = new MarketSummaryService(
      { getCandles } as never,
      { sendAnalysisMessage } as never
    );

    await service.checkH4Closes();

    expect(sendAnalysisMessage).toHaveBeenCalledTimes(1);
    expect(sendAnalysisMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'h4-summary',
        content: expect.stringContaining('BTCUSDT')
      })
    );
  });
});
