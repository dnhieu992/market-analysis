import type { Candle } from '@app/core';

import { DailyAnalysisService } from '../src/modules/analysis/daily-analysis.service';

function makeCandles(count: number, base: number, descending = false): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const offset = descending ? (count - i) * 10 : i * 10;
    return {
      open: base + offset,
      high: base + offset + (i % 3 === 1 ? 200 : 50),
      low: base + offset - (i % 3 === 0 ? 200 : 20),
      close: base + offset + 5,
      volume: 1000,
      openTime: new Date(Date.UTC(2026, 0, i + 1)),
      closeTime: new Date(Date.UTC(2026, 0, i + 1, 23, 59))
    };
  });
}

describe('DailyAnalysisService', () => {
  function makeService(
    d1Candles: Candle[],
    h4Candles: Candle[],
    repo?: { findByDate: jest.Mock; create: jest.Mock; listLatest: jest.Mock }
  ) {
    const getCandles = jest.fn().mockImplementation((_symbol: string, timeframe: string) => {
      return Promise.resolve(timeframe === '1d' ? d1Candles : h4Candles);
    });
    const defaultRepo = {
      findByDate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      listLatest: jest.fn().mockResolvedValue([])
    };
    return {
      service: new DailyAnalysisService({ getCandles } as never, repo ?? defaultRepo),
      repo: repo ?? defaultRepo
    };
  }

  it('fetches D1 candles with limit 100 and H4 candles with limit 100', async () => {
    const getCandles = jest.fn().mockResolvedValue(makeCandles(100, 80000));
    const service = new DailyAnalysisService(
      { getCandles } as never,
      { findByDate: jest.fn().mockResolvedValue(null), create: jest.fn(), listLatest: jest.fn() }
    );

    await service.analyze('BTCUSDT');

    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', '1d', 100);
    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', '4h', 100);
  });

  it('analyze returns result with symbol, date, trends, levels, and summary', async () => {
    const { service } = makeService(makeCandles(20, 80000), makeCandles(100, 80000));
    const result = await service.analyze('BTCUSDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.date).toBeInstanceOf(Date);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.d1.trend);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.h4.trend);
    expect(typeof result.d1.s1).toBe('number');
    expect(typeof result.d1.r1).toBe('number');
    expect(typeof result.summary).toBe('string');
    expect(result.summary).toContain('BTCUSDT');
  });

  it('analyzeAndSave saves to repository and returns result', async () => {
    const { service, repo } = makeService(makeCandles(20, 80000), makeCandles(100, 80000));
    const outcome = await service.analyzeAndSave('BTCUSDT');

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(outcome.skipped).toBe(false);
    expect(outcome.result.symbol).toBe('BTCUSDT');
  });

  it('analyzeAndSave skips when record already exists for today', async () => {
    const existingRecord = { id: 'existing', symbol: 'BTCUSDT' };
    const repo = {
      findByDate: jest.fn().mockResolvedValue(existingRecord),
      create: jest.fn(),
      listLatest: jest.fn()
    };
    const { service } = makeService(makeCandles(20, 80000), makeCandles(100, 80000), repo);

    const outcome = await service.analyzeAndSave('BTCUSDT');

    expect(repo.create).not.toHaveBeenCalled();
    expect(outcome.skipped).toBe(true);
  });

  it('summary includes D1 and H4 level labels', async () => {
    const { service } = makeService(makeCandles(20, 80000), makeCandles(100, 80000));
    const result = await service.analyze('BTCUSDT');

    expect(result.summary).toContain('D1 Levels');
    expect(result.summary).toContain('H4 Levels');
    expect(result.summary).toContain('S1');
    expect(result.summary).toContain('R1');
  });
});
