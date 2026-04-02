import type { Candle } from '@app/core';

import {
  deriveCandleProcessingKey,
  getClosedCandles,
  getLatestClosedCandle,
  isCandleClosed
} from '../src/modules/market/utils/candle-timing';

describe('candle timing', () => {
  const now = new Date('2026-04-01T12:00:00.000Z');

  it('accepts candles whose close time is in the past', () => {
    expect(isCandleClosed(new Date('2026-04-01T11:59:59.000Z'), now)).toBe(true);
  });

  it('rejects candles that have not closed yet', () => {
    expect(isCandleClosed(new Date('2026-04-01T12:00:01.000Z'), now)).toBe(false);
  });

  it('returns only closed candles and picks the latest closed candle', () => {
    const candles: Candle[] = [
      { open: 1, high: 2, low: 0.5, close: 1.5, closeTime: new Date('2026-04-01T04:00:00.000Z') },
      { open: 2, high: 3, low: 1.5, close: 2.5, closeTime: new Date('2026-04-01T08:00:00.000Z') },
      { open: 3, high: 4, low: 2.5, close: 3.5, closeTime: new Date('2026-04-01T12:30:00.000Z') }
    ];

    expect(getClosedCandles(candles, now)).toHaveLength(2);
    expect(getLatestClosedCandle(candles, now)?.closeTime?.toISOString()).toBe(
      '2026-04-01T08:00:00.000Z'
    );
  });

  it('derives a stable deduplication key from symbol timeframe and close time', () => {
    expect(
      deriveCandleProcessingKey('BTCUSDT', '4h', new Date('2026-04-01T08:00:00.000Z'))
    ).toBe('BTCUSDT:4h:2026-04-01T08:00:00.000Z');
  });
});
