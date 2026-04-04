import type { Candle } from '@app/core';

import { SonicRSignalService } from '../src/modules/analysis/sonic-r-signal.service';

// Build 100 candles with controllable close/high/low values
function makeCandles(count: number, base: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    open: base + i,
    high: base + i + 100,
    low: base + i - 100,
    close: base + i,
    openTime: new Date(Date.UTC(2026, 0, 1, i * 0.5)),
    closeTime: new Date(Date.UTC(2026, 0, 1, i * 0.5 + 0.4))
  }));
}

describe('SonicRSignalService', () => {
  it('returns BUY when close is above dragonHigh', async () => {
    const candles = makeCandles(100, 80000);
    candles[99] = { ...candles[99]!, close: 200000, high: 200100, low: 199900 };

    const marketDataService = {
      getCandles: jest.fn().mockResolvedValue(candles)
    };
    const service = new SonicRSignalService(marketDataService as never);

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('BUY');
    expect(signal.symbol).toBe('BTCUSDT');
    expect(signal.timeframe).toBe('M30');
    expect(signal.stopLoss).toBeDefined();
    expect(signal.target).toBeDefined();
    expect(signal.stopLoss!).toBeLessThan(signal.close);
    expect(signal.target!).toBeGreaterThan(signal.close);
  });

  it('returns SELL when close is below dragonLow', async () => {
    const candles = makeCandles(100, 80000);
    candles[99] = { ...candles[99]!, close: 1000, high: 1100, low: 900 };

    const marketDataService = {
      getCandles: jest.fn().mockResolvedValue(candles)
    };
    const service = new SonicRSignalService(marketDataService as never);

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('SELL');
    expect(signal.stopLoss!).toBeGreaterThan(signal.close);
    expect(signal.target!).toBeLessThan(signal.close);
  });

  it('returns NEUTRAL when close is inside the Dragon', async () => {
    const candles = makeCandles(100, 80000);

    const marketDataService = {
      getCandles: jest.fn().mockResolvedValue(candles)
    };
    const service = new SonicRSignalService(marketDataService as never);

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('NEUTRAL');
    expect(signal.stopLoss).toBeUndefined();
    expect(signal.target).toBeUndefined();
  });

  it('fetches M30 candles with limit 100', async () => {
    const candles = makeCandles(100, 80000);
    const getCandles = jest.fn().mockResolvedValue(candles);
    const service = new SonicRSignalService({ getCandles } as never);

    await service.getSignal('BTCUSDT');

    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', 'M30', 100);
  });
});
