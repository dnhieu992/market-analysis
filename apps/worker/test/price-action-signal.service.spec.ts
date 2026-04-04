import type { Candle } from '@app/core';

import { PriceActionSignalService } from '../src/modules/analysis/price-action-signal.service';

// Build candles with alternating swing highs/lows to produce a BULLISH trend
// Each pair: a swing low followed by a higher swing high
function makeBullishCandles(count: number, base: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const trend = i * 10;
    return {
      open: base + trend,
      high: base + trend + (i % 3 === 1 ? 200 : 50),
      low: base + trend - (i % 3 === 0 ? 200 : 20),
      close: base + trend + 5,
      openTime: new Date(Date.UTC(2026, 0, 1, i)),
      closeTime: new Date(Date.UTC(2026, 0, 1, i, 0, 59))
    };
  });
}

function makeBearishCandles(count: number, base: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const trend = i * 10;
    return {
      open: base - trend,
      high: base - trend + (i % 3 === 0 ? 20 : 50),
      low: base - trend - (i % 3 === 1 ? 200 : 50),
      close: base - trend - 5,
      openTime: new Date(Date.UTC(2026, 0, 1, i)),
      closeTime: new Date(Date.UTC(2026, 0, 1, i, 0, 59))
    };
  });
}

function makeNeutralCandles(count: number, base: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    open: base,
    high: base + 100,
    low: base - 100,
    close: base,
    openTime: new Date(Date.UTC(2026, 0, 1, i)),
    closeTime: new Date(Date.UTC(2026, 0, 1, i, 0, 59))
  }));
}

describe('PriceActionSignalService', () => {
  function makeService(h4Candles: Candle[], m30Candles: Candle[]) {
    const getCandles = jest.fn().mockImplementation((_symbol: string, timeframe: string) => {
      return Promise.resolve(timeframe === '4h' ? h4Candles : m30Candles);
    });
    return new PriceActionSignalService({ getCandles } as never);
  }

  it('fetches 4h candles with limit 20 and M30 candles with limit 100', async () => {
    const getCandles = jest.fn().mockResolvedValue(makeNeutralCandles(20, 80000));
    const service = new PriceActionSignalService({ getCandles } as never);

    await service.getSignal('BTCUSDT');

    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', '4h', 20);
    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', 'M30', 100);
  });

  it('returns NO_SIGNAL when trend is NEUTRAL', async () => {
    const service = makeService(
      makeNeutralCandles(20, 80000),
      makeNeutralCandles(100, 80000)
    );

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('NO_SIGNAL');
    expect(signal.trend).toBe('NEUTRAL');
    expect(signal.stopLoss).toBeUndefined();
    expect(signal.target).toBeUndefined();
  });

  it('returns NO_SIGNAL when trend is bullish but no key level active', async () => {
    // M30 close is far from any swing level (ATR won't bridge the gap)
    const m30 = makeNeutralCandles(100, 80000);
    // push close far from swing points
    m30[99] = { ...m30[99]!, close: 90000, open: 89900, high: 90100, low: 89800 };

    const service = makeService(makeBullishCandles(20, 80000), m30);
    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('NO_SIGNAL');
    expect(signal.keyLevel).toBeNull();
  });

  it('has correct symbol and timeframe on all results', async () => {
    const service = makeService(
      makeNeutralCandles(20, 80000),
      makeNeutralCandles(100, 80000)
    );

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.symbol).toBe('BTCUSDT');
    expect(signal.timeframe).toBe('M30');
  });

  it('returns NO_SIGNAL with trend populated when trend is BEARISH but no confluence', async () => {
    const service = makeService(
      makeBearishCandles(20, 80000),
      makeNeutralCandles(100, 80000)
    );

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('NO_SIGNAL');
    expect(signal.trend).toBe('BEARISH');
  });

  it('returns BUY when all four checks align (bullish trend, key support, bullish pattern, bullish BOS)', async () => {
    // Build M30 candles that satisfy all 4 checks simultaneously.
    // All candles are centred at base=80000 with ATR≈200 so small offsets stay within 1×ATR.

    const base = 80000;
    const m30 = Array.from({ length: 100 }, (_, i): Candle => ({
      open: base,
      high: base + 100,
      low: base - 100,
      close: base,
      openTime: new Date(Date.UTC(2026, 0, 1, 0, i * 30)),
      closeTime: new Date(Date.UTC(2026, 0, 1, 0, i * 30 + 29))
    }));

    // Check 1 – key support: swing low at index 90 with low = base-80 (within 1×ATR of close≈base)
    m30[89] = { ...m30[89]!, low: base - 30, high: base + 100 };
    m30[90] = { ...m30[90]!, low: base - 80, high: base + 80 }; // swing low
    m30[91] = { ...m30[91]!, low: base - 30, high: base + 100 };

    // Check 3 – BOS: swing high at index 88 (priorSwingHigh = base+200)
    const priorSwingHigh = base + 200;
    m30[87] = { ...m30[87]!, high: base + 80 };
    m30[88] = { ...m30[88]!, high: priorSwingHigh, low: base - 50 };
    m30[89] = { ...m30[89]!, high: base + 80 }; // keep 89 lower than 88

    // BOS break at index 95, retest at index 97
    m30[95] = { ...m30[95]!, high: priorSwingHigh + 50, low: priorSwingHigh - 80, open: priorSwingHigh - 20, close: priorSwingHigh + 30 };
    m30[97] = { ...m30[97]!, high: priorSwingHigh + 20, low: priorSwingHigh - 40, open: priorSwingHigh - 10, close: priorSwingHigh + 5 };

    // Check 2 – bullish engulfing at candles 98 (bearish) / 99 (bullish engulfs 98)
    m30[98] = { ...m30[98]!, open: base + 20, close: base - 20, high: base + 50, low: base - 50 };
    m30[99] = {
      open: m30[98]!.close - 5,
      close: m30[98]!.open + 10,
      high: m30[98]!.open + 30,
      low: m30[98]!.close - 10,
      openTime: new Date(Date.UTC(2026, 0, 1, 0, 99 * 30)),
      closeTime: new Date(Date.UTC(2026, 0, 1, 0, 99 * 30 + 29))
    };

    const service = makeService(makeBullishCandles(20, 80000), m30);
    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('BUY');
    expect(signal.stopLoss).toBeDefined();
    expect(signal.target).toBeDefined();
    expect(signal.target!).toBeGreaterThan(signal.close);
    expect(signal.trend).toBe('BULLISH');
    expect(signal.keyLevel).not.toBeNull();
    expect(signal.pattern).not.toBeNull();
    expect(signal.bosLevel).not.toBeNull();
  });
});
