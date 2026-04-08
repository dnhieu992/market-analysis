import { formatDailyAnalysisPlanMessage } from './format-daily-analysis-plan-message';

function makeCandles() {
  return Array.from({ length: 100 }, (_, index) => ({
    time: `2026-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00+07:00`,
    open: 68000 + index,
    high: 68050 + index,
    low: 67950 + index,
    close: 68010 + index,
    volume: 1000 + index
  }));
}

describe('formatDailyAnalysisPlanMessage', () => {
  it('formats a detailed daily plan report', () => {
    const message = formatDailyAnalysisPlanMessage({
      symbol: 'BTCUSDT',
      date: new Date('2026-04-07T00:00:00.000Z'),
      marketData: {
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
            ohlcv: makeCandles(),
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
            volumeRatio: 1.02,
            levels: {
              support: [67360.66, 66611.66],
              resistance: [68698.7, 69310]
            },
            swingHigh: 69310,
            swingLow: 66611.66
          },
          H4: {
            trend: 'bearish',
            ohlcv: makeCandles(),
            ema20: 68329.82,
            ema50: 68039.53,
            ema200: 68162.45,
            rsi14: 49.91,
            macd: {
              line: 373.17,
              signal: 418.98,
              histogram: -45.81
            },
            atr14: 912.09,
            volumeRatio: 0.137539,
            levels: {
              support: [68153, 68110.55],
              resistance: [68169.65, 68408.37]
            },
            swingHigh: 68408.37,
            swingLow: 68153
          }
        },
        marketFlags: {
          majorNewsNearby: false,
          liquidityCondition: 'thin',
          marketRegime: 'compressed'
        }
      },
      plan: {
        summary: 'Hiện tại chưa có kèo đẹp để vào ngay.',
        bias: 'Neutral',
        confidence: 0,
        status: 'WAIT',
        timeframeContext: {
          biasFrame: 'D1',
          setupFrame: 'H4',
          entryRefinementFrame: 'none',
          higherTimeframeView: 'D1 vẫn nghiêng bullish.',
          setupTimeframeView: 'H4 đang bearish và giá đang nén rất chặt.',
          alignment: 'conflicting'
        },
        marketState: {
          trendCondition: 'compressed',
          volumeCondition: 'very_weak',
          volatilityCondition: 'high',
          keyObservation: 'Khối lượng thấp, động lượng yếu, nên ưu tiên đứng ngoài.'
        },
        setupType: 'breakout',
        noTradeZone: 'Không vào lệnh khi giá vẫn còn nằm trong vùng nén H4.',
        primarySetup: {
          direction: 'long',
          trigger: 'Nến H4 đóng trên 68408.37',
          entry: 'Sau khi breakout H4 được xác nhận trên 68408.37',
          stopLoss: 'Dưới 68110.55. Vùng stop tham khảo: 68050',
          takeProfit1: '68698.70',
          takeProfit2: '69310',
          riskReward: '2.1',
          invalidation: 'Nến H4 đóng dưới 68110.55 thì setup long bị vô hiệu'
        },
        secondarySetup: {
          direction: 'none',
          trigger: 'N/A',
          entry: 'N/A',
          stopLoss: 'N/A',
          takeProfit1: 'N/A',
          takeProfit2: 'N/A',
          riskReward: 'N/A',
          invalidation: 'N/A'
        },
        finalAction: 'Hôm nay ưu tiên chờ, không vào sớm.',
        reasoning: ['D1 bullish nhưng H4 đang bearish.', 'Volume thấp nên breakout cần xác nhận.'],
        atrConsistencyCheck: {
          result: 'WARNING',
          details: 'ATR còn lớn nhưng setup chưa đủ xác nhận.'
        },
        logicConsistencyCheck: {
          result: 'PASS',
          details: 'Narrative và hành động tạm thời đồng nhất.'
        }
      }
    });

    expect(message).toContain('BTCUSDT Daily Plan — 2026-04-07');
    expect(message).toContain('1) Tóm tắt nhanh');
    expect(message).toContain('Bias: Neutral');
    expect(message).toContain('Confidence: 0%');
    expect(message).toContain('Time horizon: Intraday đến 1 ngày');
    expect(message).toContain('Kết luận nhanh:');
    expect(message).toContain('Hiện tại chưa có kèo đẹp để vào ngay.');
    expect(message).toContain('2) Bối cảnh thị trường');
    expect(message).toContain('Khung D1');
    expect(message).toContain('Xu hướng chính: Bullish');
    expect(message).toContain('S1: 67,360.66');
    expect(message).toContain('R2: 69,310');
    expect(message).toContain('H4 resistance: 68,169.65 / 68,408.37');
    expect(message).toContain('=> H4 đang cho tín hiệu mâu thuẫn với D1, nên không phù hợp để vào lệnh sớm.');
    expect(message).toContain('3) Tín hiệu kỹ thuật chính');
    expect(message).toContain('EMA200: 68,162.45');
    expect(message).toContain('Các EMA đang nằm sát nhau, cho thấy thị trường đang sideway / consolidation.');
    expect(message).toContain('RSI14: 49.91');
    expect(message).toContain('Volume ratio: 0.137539');
    expect(message).toContain('Khối lượng rất thấp, breakout nếu có cũng cần xác nhận thêm volume.');
    expect(message).toContain('ATR14: 912.09');
    expect(message).toContain('Biến động nền vẫn lớn, nên nếu breakout xảy ra có thể chạy khá mạnh.');
    expect(message).toContain('4) Kế hoạch giao dịch chính');
    expect(message).toContain('Kèo Long');
    expect(message).toContain('Chỉ xem xét Long khi có:');
    expect(message).toContain('Điều kiện kích hoạt');
    expect(message).toContain('Nến H4 đóng trên 68408.37');
    expect(message).toContain('Take profit');
    expect(message).toContain('5) Scenarios');
    expect(message).toContain('Bullish scenario');
    expect(message).toContain('Nếu giá breakout lên trên 68,408.37');
    expect(message).toContain('Bearish scenario');
    expect(message).toContain('Nếu giá không giữ được cấu trúc hiện tại và nến H4 đóng dưới 68,110.55');
    expect(message).toContain('6) Điều cần tránh');
    expect(message).toContain('Không vào lệnh khi giá vẫn còn nằm trong vùng nén H4');
    expect(message).toContain('7) Kết luận hành động');
    expect(message).toContain('Hôm nay ưu tiên chờ, không vào sớm.');
    expect(message).toContain('Kèo đẹp nhất là:');
    expect(message).toContain('Long khi H4 close trên 68,408.37 + volume tốt');
  });

  it('describes non-compressed H4 structure without using the compressed wording', () => {
    const message = formatDailyAnalysisPlanMessage({
      symbol: 'BTCUSDT',
      date: new Date('2026-04-07T00:00:00.000Z'),
      marketData: {
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
            ohlcv: makeCandles(),
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
            volumeRatio: 1.02,
            levels: {
              support: [67360.66, 66611.66],
              resistance: [68698.7, 69310]
            },
            swingHigh: 69310,
            swingLow: 66611.66
          },
          H4: {
            trend: 'bullish',
            ohlcv: makeCandles(),
            ema20: 68329.82,
            ema50: 68039.53,
            ema200: 68162.45,
            rsi14: 61.91,
            macd: {
              line: 373.17,
              signal: 318.98,
              histogram: 54.19
            },
            atr14: 912.09,
            volumeRatio: 1.137539,
            levels: {
              support: [68153, 68110.55],
              resistance: [68169.65, 68408.37]
            },
            swingHigh: 68408.37,
            swingLow: 68153
          }
        },
        marketFlags: {
          majorNewsNearby: false,
          liquidityCondition: 'normal',
          marketRegime: 'trending'
        }
      },
      plan: {
        summary: 'Ưu tiên theo dõi breakout cùng xu hướng.',
        bias: 'Bullish',
        confidence: 68,
        status: 'TRADE_READY',
        timeframeContext: {
          biasFrame: 'D1',
          setupFrame: 'H4',
          entryRefinementFrame: 'none',
          higherTimeframeView: 'D1 vẫn bullish.',
          setupTimeframeView: 'H4 đang ủng hộ breakout theo xu hướng.',
          alignment: 'aligned'
        },
        marketState: {
          trendCondition: 'trending',
          volumeCondition: 'strong',
          volatilityCondition: 'normal',
          keyObservation: 'Cấu trúc đang ủng hộ continuation.'
        },
        setupType: 'breakout',
        noTradeZone: 'Không đuổi theo nến breakout đã chạy quá xa.',
        primarySetup: {
          direction: 'long',
          trigger: 'H4 close trên 68408.37 kèm volume tốt.',
          entry: 'Canh retest hợp lệ sau breakout.',
          stopLoss: 'Dưới 68153.',
          takeProfit1: '68698.70',
          takeProfit2: '69310',
          riskReward: '2.0',
          invalidation: 'H4 close dưới 68153.'
        },
        secondarySetup: {
          direction: 'none',
          trigger: 'N/A',
          entry: 'N/A',
          stopLoss: 'N/A',
          takeProfit1: 'N/A',
          takeProfit2: 'N/A',
          riskReward: 'N/A',
          invalidation: 'N/A'
        },
        finalAction: 'Theo dõi breakout cùng volume xác nhận.',
        reasoning: ['D1 và H4 đang aligned.', 'Volume đang ủng hộ continuation.'],
        atrConsistencyCheck: {
          result: 'PASS',
          details: 'ATR phù hợp với swing breakout.'
        },
        logicConsistencyCheck: {
          result: 'PASS',
          details: 'Logic kế hoạch nhất quán.'
        }
      }
    });

    expect(message).toContain('Giá đang vận động theo xu hướng chính, các vùng cần theo dõi là:');
    expect(message).not.toContain('Giá đang đi ngang và nén chặt trong vùng:');
  });
});
