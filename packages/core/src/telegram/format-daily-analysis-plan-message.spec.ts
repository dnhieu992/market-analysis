import { formatDailyAnalysisPlanMessage } from './format-daily-analysis-plan-message';

describe('formatDailyAnalysisPlanMessage', () => {
  it('formats a detailed daily plan report', () => {
    const message = formatDailyAnalysisPlanMessage({
      symbol: 'BTCUSDT',
      date: new Date('2026-04-07T00:00:00.000Z'),
      d1: {
        trend: 'bullish',
        s1: 67360.66,
        s2: 66611.66,
        r1: 68698.7,
        r2: 69310
      },
      h4: {
        trend: 'bearish',
        s1: 68153,
        s2: 68110.55,
        r1: 68169.65,
        r2: 68408.37
      },
      h4Indicators: {
        ema20: 68329.82,
        ema50: 68039.53,
        ema200: 68162.45,
        rsi14: 49.91,
        macd: {
          macd: 373.17,
          signal: 418.98,
          histogram: -45.81
        },
        atr14: 912.09,
        volumeRatio: 0.137539
      },
      plan: {
        analysis: 'BTC dang giu xu huong tang trong ngay.',
        bias: 'neutral',
        confidence: 0,
        tradePlan: {
          entryZone: 'Sau khi breakout H4 duoc xac nhan tren 68408.37',
          stopLoss: 'Duoi 68110.55. Vung stop tham khao: 68050',
          takeProfit: 'TP1: 68698.70, TP2: 69310, xa hon: 69800-70000',
          invalidation: 'Nen H4 dong duoi 68110.55 thi setup long bi vo hieu'
        },
        scenarios: {
          bullishScenario: 'Neu gia breakout len tren 68408.37 va giu duoc voi volume tot, co the mo rong len 69310.',
          bearishScenario: 'Neu gia dong duoi 68110.55, uu tien dung ngoai va cho cau truc moi.'
        },
        riskNote: 'Khong duoi gia.',
        timeHorizon: 'intraday to 1 day'
      }
    });

    expect(message).toContain('BTCUSDT Daily Plan — 2026-04-07');
    expect(message).toContain('1) Tóm tắt nhanh');
    expect(message).toContain('2) Bối cảnh thị trường');
    expect(message).toContain('3) Tín hiệu kỹ thuật chính');
    expect(message).toContain('4) Kế hoạch giao dịch chính');
    expect(message).toContain('5) Scenarios');
    expect(message).toContain('6) Điều cần tránh');
    expect(message).toContain('7) Kết luận hành động');
    expect(message).toContain('Bias: Neutral');
    expect(message).toContain('Time horizon: Intraday đến 1 ngày');
    expect(message).toContain('EMA200: 68,162.45');
    expect(message).toContain('H4 resistance: 68,169.65 / 68,408.37');
    expect(message).toContain('Long khi H4 close trên 68,408.37 + volume tốt');
  });
});
