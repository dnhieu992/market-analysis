import { EmaSignalService } from '../src/modules/ema-signal/ema-signal.service';

function makeKline(open: number, high: number, low: number, close: number, closeTime = 0): [number, string, string, string, string, string, number] {
  return [0, String(open), String(high), String(low), String(close), '100', closeTime];
}

describe('EmaSignalService', () => {
  let service: EmaSignalService;
  let mockBinance: { fetchKlines: jest.Mock };

  beforeEach(() => {
    mockBinance = { fetchKlines: jest.fn() };
    service = new EmaSignalService(mockBinance as never);
  });

  it('returns no-trend message when H1 candles show neutral', async () => {
    // All closes at 100, EMA20=EMA50=100 → no trend
    const flatKlines = Array.from({ length: 100 }, () => makeKline(100, 105, 95, 100));
    mockBinance.fetchKlines
      .mockResolvedValueOnce(flatKlines)  // H1
      .mockResolvedValueOnce([]);         // M15 (not reached)

    const result = await service.getSignal('BTCUSDT');
    expect(result).toBe('No clear H1 trend for BTCUSDT');
  });

  it('returns no-entry message when H1 is bullish but no M15 pullback found', async () => {
    // H1: rising candles, close > ema20 > ema50
    const h1Klines = Array.from({ length: 100 }, (_, i) =>
      makeKline(100 + i, 102 + i, 99 + i, 101 + i)
    );
    // M15: no candle touches EMA20
    const m15Klines = Array.from({ length: 50 }, (_, i) =>
      makeKline(200 + i, 202 + i, 199 + i, 201 + i)
    );
    mockBinance.fetchKlines
      .mockResolvedValueOnce(h1Klines)
      .mockResolvedValueOnce(m15Klines);

    const result = await service.getSignal('BTCUSDT');
    expect(result).toBe('No M15 entry signal for BTCUSDT');
  });

  it('returns formatted long signal when H1 bullish and M15 pullback found', async () => {
    // H1: rising candles ensuring close > ema20 > ema50
    const h1Klines = Array.from({ length: 100 }, (_, i) =>
      makeKline(1000 + i * 10, 1005 + i * 10, 995 + i * 10, 1002 + i * 10)
    );
    // M15: flat candles so EMA20 ≈ 1002; last candle is pullback — low touches EMA20, close above it
    const m15Klines = Array.from({ length: 50 }, (_, i) => {
      if (i === 49) return makeKline(1000, 1010, 998, 1005); // pullback candle: low<=EMA20, close>EMA20
      return makeKline(1002, 1005, 999, 1002); // flat candles keep EMA20 ≈ 1002
    });
    mockBinance.fetchKlines
      .mockResolvedValueOnce(h1Klines)
      .mockResolvedValueOnce(m15Klines);

    const result = await service.getSignal('BTCUSDT');
    expect(result).toContain('LONG');
    expect(result).toContain('BTCUSDT-M15');
    expect(result).toContain('Strategy: EMA20-50');
    expect(result).toContain('Open:');
    expect(result).toContain('TP:');
    expect(result).toContain('SL:');
  });

  it('returns waiting message when pullback candle has not closed yet', async () => {
    const h1Klines = Array.from({ length: 100 }, (_, i) =>
      makeKline(1000 + i * 10, 1005 + i * 10, 995 + i * 10, 1002 + i * 10)
    );
    const futureCloseTime = Date.now() + 60_000; // candle closes in 1 minute
    const m15Klines = Array.from({ length: 50 }, (_, i) => {
      if (i === 49) return makeKline(1000, 1010, 998, 1005, futureCloseTime); // still open
      return makeKline(1002, 1005, 999, 1002);
    });
    mockBinance.fetchKlines
      .mockResolvedValueOnce(h1Klines)
      .mockResolvedValueOnce(m15Klines);

    const result = await service.getSignal('BTCUSDT');
    expect(result).toBe('Waiting for M15 candle to close for BTCUSDT...');
  });

  it('returns error message when Binance throws', async () => {
    mockBinance.fetchKlines.mockRejectedValue(new Error('network error'));
    const result = await service.getSignal('BTCUSDT');
    expect(result).toBe('Failed to fetch data for BTCUSDT, please try again');
  });
});
