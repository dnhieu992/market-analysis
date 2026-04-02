import { buildAnalysisPrompt } from './build-analysis-prompt';

describe('buildAnalysisPrompt', () => {
  it('builds a compact vietnamese-first payload from supplied market data only', () => {
    const prompt = buildAnalysisPrompt({
      symbol: 'BTCUSDT',
      timeframe: '4h',
      indicators: {
        price: { open: 100, high: 110, low: 95, close: 108 },
        ema20: 102,
        ema50: 99,
        ema200: 90,
        rsi14: 61,
        macd: { macd: 2, signal: 1.5, histogram: 0.5 },
        atr14: 4,
        volumeRatio: 1.2,
        supportLevels: [100, 98],
        resistanceLevels: [110, 115],
        lastCandles: [{ open: 100, high: 110, low: 95, close: 108 }]
      }
    });

    expect(prompt.system).toMatch(/Vietnamese/i);
    expect(prompt.user).toContain('"symbol":"BTCUSDT"');
    expect(prompt.user).not.toMatch(/news/i);
  });
});
