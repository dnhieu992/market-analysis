import { formatAnalysisMessage } from './format-analysis-message';

describe('formatAnalysisMessage', () => {
  it('formats a compact mobile-friendly telegram analysis message', () => {
    const message = formatAnalysisMessage({
      symbol: 'BTCUSDT',
      timeframe: '4h',
      trend: 'uptrend',
      bias: 'bullish',
      confidence: 78,
      summary: 'Gia dang giu tren EMA20.',
      supportLevels: [67200, 66550],
      resistanceLevels: [68700, 69500],
      bullishScenario: 'Neu giu tren 68,000, kha nang tiep tuc tang.',
      bearishScenario: 'Neu mat 66,550, dong luc suy yeu.',
      invalidation: 'Dong nen duoi 66,550.'
    });

    expect(message).toContain('BTCUSDT');
    expect(message).toContain('Do tin cay');
    expect(message).toContain('Day la phan tich tu dong');
  });
});
