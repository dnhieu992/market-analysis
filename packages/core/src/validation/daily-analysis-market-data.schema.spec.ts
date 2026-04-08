import { dailyAnalysisMarketDataSchema } from './daily-analysis-market-data.schema';

function buildCandles(count: number, baseClose: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = baseClose + index * 10;

    return {
      time: `2026-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00+07:00`,
      open: close - 5,
      high: close + 20,
      low: close - 30,
      close,
      volume: 1000 + index * 3
    };
  });
}

describe('dailyAnalysisMarketDataSchema', () => {
  it('parses the structured D1 and H4 market data contract with sufficient candle history', () => {
    const parsed = dailyAnalysisMarketDataSchema.parse({
      symbol: 'BTCUSDT',
      exchange: 'Binance',
      timestamp: '2026-04-07T20:30:00+07:00',
      currentPrice: 68395.2,
      session: 'Asia',
      strategyProfile: {
        biasFrame: 'D1',
        setupFrame: 'H4',
        entryRefinementFrame: 'none',
        strategyType: 'breakout_following',
        allowNoTrade: true,
        minimumRr: 1.5,
        preferredBreakoutRr: 2,
        avoidScalpingLogic: true
      },
      timeframes: {
        D1: {
          trend: 'bullish',
          ohlcv: buildCandles(120, 67000),
          ema20: 67520.4,
          ema50: 66210.8,
          ema200: 59880.1,
          rsi14: 61.2,
          macd: {
            line: 820.3,
            signal: 760.1,
            histogram: 60.2
          },
          atr14: 1850.4,
          volumeRatio: 1.1,
          levels: {
            support: [67360.66, 66611.66],
            resistance: [68698.7, 69310]
          },
          swingHigh: 69310,
          swingLow: 66611.66
        },
        H4: {
          trend: 'bearish',
          ohlcv: buildCandles(120, 68120),
          ema20: 68356.07,
          ema50: 68050.34,
          ema200: 68438,
          rsi14: 53.13,
          macd: {
            line: 395.15,
            signal: 423.37,
            histogram: -28.23
          },
          atr14: 912.08,
          volumeRatio: 0.21,
          levels: {
            support: [68273.34, 68153],
            resistance: [68589.49, 68653.38]
          },
          swingHigh: 68653.38,
          swingLow: 68153,
          breakoutLevel: 68653.38,
          retestZone: [68589.49, 68653.38]
        }
      },
      marketFlags: {
        majorNewsNearby: false,
        liquidityCondition: 'normal',
        marketRegime: 'compressed'
      }
    });

    expect(parsed.strategyProfile.entryRefinementFrame).toBe('none');
    expect(parsed.timeframes.D1.ohlcv).toHaveLength(120);
    expect(parsed.timeframes.H4.breakoutLevel).toBe(68653.38);
  });

  it('rejects under-specified market data payloads', () => {
    expect(() =>
      dailyAnalysisMarketDataSchema.parse({
        symbol: 'BTCUSDT',
        exchange: 'Binance',
        timestamp: '2026-04-07T20:30:00+07:00',
        currentPrice: 68395.2,
        session: 'Asia',
        strategyProfile: {
          biasFrame: 'D1',
          setupFrame: 'H4',
          entryRefinementFrame: 'none',
          strategyType: 'breakout_following',
          allowNoTrade: true,
          minimumRr: 1.5,
          preferredBreakoutRr: 2,
          avoidScalpingLogic: true
        },
        timeframes: {
          D1: {
            trend: 'bullish',
            ohlcv: buildCandles(1, 67000),
            ema20: 67520.4,
            ema50: 66210.8,
            ema200: 59880.1,
            rsi14: 61.2,
            macd: {
              line: 820.3,
              signal: 760.1,
              histogram: 60.2
            },
            atr14: 1850.4,
            volumeRatio: 1.1,
            levels: {
              support: [],
              resistance: []
            },
            swingHigh: 69310,
            swingLow: 66611.66
          },
          H4: {
            trend: 'bearish',
            ohlcv: buildCandles(1, 68120),
            ema20: 68356.07,
            ema50: 68050.34,
            ema200: 68438,
            rsi14: 53.13,
            macd: {
              line: 395.15,
              signal: 423.37,
              histogram: -28.23
            },
            atr14: 912.08,
            volumeRatio: 0.21,
            levels: {
              support: [],
              resistance: []
            },
            swingHigh: 68653.38,
            swingLow: 68153
          }
        }
      })
    ).toThrow();
  });
});
