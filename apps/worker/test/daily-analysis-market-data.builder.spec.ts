import {
  buildIndicatorSnapshot,
  dailyAnalysisMarketDataSchema,
  type Candle
} from '@app/core';

import { buildDailyAnalysisMarketData } from '../src/modules/analysis/daily-analysis-market-data.builder';

function makeCandles(count: number, baseClose: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = baseClose + index * 10;

    return {
      open: close - 5,
      high: close + 20,
      low: close - 30,
      close,
      volume: 1000 + index * 3,
      openTime: new Date(Date.UTC(2026, 3, (index % 28) + 1, 0, 0)),
      closeTime: new Date(Date.UTC(2026, 3, (index % 28) + 1, 1, 0))
    };
  });
}

describe('buildDailyAnalysisMarketData', () => {
  it('builds the structured market_data payload from D1 and H4 inputs', () => {
    const d1Candles = makeCandles(200, 67000);
    const h4Candles = makeCandles(200, 68120);
    const h4Indicators = buildIndicatorSnapshot(h4Candles);

    const marketData = buildDailyAnalysisMarketData({
      symbol: 'BTCUSDT',
      date: new Date('2026-04-07T00:00:00.000Z'),
      currentPrice: 70000.55,
      d1Candles,
      h4Candles,
      d1: {
        trend: 'bullish',
        s1: 67360.66,
        s2: 66611.66,
        r1: 68698.7,
        r2: 69310
      },
      h4: {
        trend: 'bearish',
        s1: 68273.34,
        s2: 68153,
        r1: 68589.49,
        r2: 68653.38
      },
      h4Indicators
    });

    const parsed = dailyAnalysisMarketDataSchema.parse(marketData);

    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.exchange).toBe('Binance');
    expect(parsed.timestamp).toBe('2026-04-07T00:00:00.000Z');
    expect(parsed.currentPrice).toBe(70000.55);
    expect(parsed.strategyProfile).toEqual(
      expect.objectContaining({
        biasFrame: 'D1',
        setupFrame: 'H4',
        entryRefinementFrame: 'none',
        strategyType: 'breakout_following'
      })
    );
    expect(parsed.timeframes.D1.ohlcv).toHaveLength(200);
    expect(parsed.timeframes.H4.ohlcv).toHaveLength(200);
    expect(parsed.timeframes.D1.levels.support).toEqual([67360.66, 66611.66]);
    expect(parsed.timeframes.H4.levels.resistance).toEqual([68589.49, 68653.38]);
    expect(parsed.timeframes.D1).not.toHaveProperty('breakoutLevel');
    expect(parsed.timeframes.D1).not.toHaveProperty('retestZone');
    expect(parsed.timeframes.H4).not.toHaveProperty('breakoutLevel');
    expect(parsed.timeframes.H4).not.toHaveProperty('retestZone');
    expect(parsed.marketFlags).toEqual(
      expect.objectContaining({
        majorNewsNearby: false
      })
    );
  });

  it('falls back to finite levels and omits breakout metadata for sparse inputs', () => {
    const h4Candles = makeCandles(200, 68120);
    const marketData = buildDailyAnalysisMarketData({
      symbol: 'BTCUSDT',
      date: new Date('2026-04-07T00:00:00.000Z'),
      currentPrice: 68395.2,
      d1Candles: makeCandles(200, 67000),
      h4Candles,
      d1: {
        trend: 'bullish',
        s1: Number.NaN,
        s2: Number.NaN,
        r1: Number.NaN,
        r2: Number.NaN
      },
      h4: {
        trend: 'bearish',
        s1: Number.NaN,
        s2: Number.NaN,
        r1: Number.NaN,
        r2: Number.NaN
      },
      h4Indicators: buildIndicatorSnapshot(h4Candles)
    });

    const parsed = dailyAnalysisMarketDataSchema.parse(marketData);

    expect(parsed.timeframes.D1.levels.support).toEqual([68395.2]);
    expect(parsed.timeframes.D1.levels.resistance).toEqual([68395.2]);
    expect(parsed.timeframes.H4.levels.support).toEqual([68395.2]);
    expect(parsed.timeframes.H4.levels.resistance).toEqual([68395.2]);
    expect(parsed.timeframes.D1.swingHigh).toBe(68395.2);
    expect(parsed.timeframes.D1.swingLow).toBe(68395.2);
    expect(parsed.timeframes.H4.swingHigh).toBe(68395.2);
    expect(parsed.timeframes.H4.swingLow).toBe(68395.2);
    expect(parsed.timeframes.D1).not.toHaveProperty('breakoutLevel');
    expect(parsed.timeframes.D1).not.toHaveProperty('retestZone');
    expect(parsed.timeframes.H4).not.toHaveProperty('breakoutLevel');
    expect(parsed.timeframes.H4).not.toHaveProperty('retestZone');
  });
});
