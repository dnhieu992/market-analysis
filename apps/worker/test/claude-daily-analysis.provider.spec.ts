import type {
  DailyAnalysisAnalystDraft,
  DailyAnalysisMarketData,
  DailyAnalysisValidatorResult
} from '@app/core';

import {
  ClaudeDailyAnalysisProvider,
  resolveClaudeTimeoutMs
} from '../src/modules/llm/claude-daily-analysis.provider';

function makeMarketData(): DailyAnalysisMarketData {
  const candles = Array.from({ length: 120 }, (_, index) => ({
    time: `2026-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00+07:00`,
    open: 68000 + index,
    high: 68050 + index,
    low: 67950 + index,
    close: 68010 + index,
    volume: 1000 + index
  }));

  return {
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
        ohlcv: candles,
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
        ohlcv: candles,
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
        volumeRatio: 0.2177,
        levels: {
          support: [68273.34, 68153],
          resistance: [68169.65, 68408.37]
        },
        swingHigh: 68408.37,
        swingLow: 68153
      }
    },
    marketFlags: {
      majorNewsNearby: false,
      liquidityCondition: 'normal',
      marketRegime: 'compressed'
    }
  };
}

function makeAnalystDraft(): DailyAnalysisAnalystDraft {
  return {
    summary: 'BTCUSDT đang nén trong biên breakout H4.',
    bias: 'Neutral',
    confidence: 42,
    status: 'WAIT',
    timeframeContext: {
      biasFrame: 'D1',
      setupFrame: 'H4',
      entryRefinementFrame: 'none',
      higherTimeframeView: 'D1 còn bullish nhưng chưa đủ lực breakout.',
      setupTimeframeView: 'H4 đang bearish và cần xác nhận.',
      alignment: 'conflicting'
    },
    marketState: {
      trendCondition: 'compressed',
      volumeCondition: 'very_weak',
      volatilityCondition: 'normal',
      keyObservation: 'Giá nén chặt, volume yếu, chưa có kèo đẹp.'
    },
    setupType: 'breakout',
    noTradeZone: 'Tránh vào khi H4 còn nằm trong biên nén.',
    primarySetup: {
      direction: 'long',
      trigger: 'H4 close trên 68408.37 kèm volume tăng.',
      entry: 'Chờ breakout xác nhận.',
      stopLoss: 'Dưới 68153.',
      takeProfit1: '68698.7',
      takeProfit2: '69310',
      riskReward: '1:2',
      invalidation: 'H4 close dưới 68153.'
    },
    secondarySetup: {
      direction: 'none',
      trigger: 'Chưa có setup phụ.',
      entry: 'Đứng ngoài.',
      stopLoss: 'N/A',
      takeProfit1: 'N/A',
      takeProfit2: 'N/A',
      riskReward: 'N/A',
      invalidation: 'N/A'
    },
    atrConsistencyCheck: {
      result: 'WARNING',
      details: 'ATR phù hợp breakout nhưng chưa có xác nhận.'
    },
    logicConsistencyCheck: {
      result: 'PASS',
      details: 'Bias và hành động tạm thời còn nhất quán.'
    },
    reasoning: ['D1 bullish nhưng H4 chưa xác nhận breakout.'],
    finalAction: 'Chờ breakout H4 rõ ràng rồi mới xem xét vào lệnh.'
  };
}

function makeValidatorResult(): DailyAnalysisValidatorResult {
  return {
    validationResult: 'APPROVED_WITH_ADJUSTMENTS',
    summary: 'Draft hợp lý nhưng cần giữ trạng thái WAIT vì volume yếu.',
    majorIssues: [],
    minorIssues: ['Confidence nên giảm nhẹ do H4 đang conflict với D1.'],
    checks: {
      timeframeConsistency: {
        result: 'WARNING',
        details: 'D1/H4 conflict, nhưng hướng breakout vẫn hợp lý.'
      },
      breakoutLogic: {
        result: 'PASS',
        details: 'Trigger và invalidation logic đúng.'
      },
      riskReward: {
        result: 'PASS',
        details: 'RR đạt mức tối thiểu.'
      },
      atrConsistency: {
        result: 'PASS',
        details: 'ATR phù hợp với breakout swing plan.'
      },
      volumeConfirmation: {
        result: 'WARNING',
        details: 'Volume còn yếu nên chưa nên trade ngay.'
      },
      narrativeVsAction: {
        result: 'PASS',
        details: 'Narrative phù hợp với trạng thái WAIT.'
      },
      structureQuality: {
        result: 'PASS',
        details: 'Cấu trúc đủ rõ cho một breakout watchlist.'
      }
    },
    correctedPlan: {
      summary: 'BTCUSDT đang ở trạng thái chờ breakout xác nhận.',
      bias: 'Neutral',
      confidence: 38,
      status: 'WAIT',
      setupType: 'breakout',
      primarySetup: {
        direction: 'long',
        trigger: 'H4 close trên 68408.37 kèm volume tốt.',
        entry: 'Chờ xác nhận rồi mới cân nhắc vào.',
        stopLoss: 'Dưới 68153.',
        takeProfit1: '68698.7',
        takeProfit2: '69310',
        riskReward: '1:2',
        invalidation: 'H4 close dưới 68153.'
      },
      finalAction: 'Đứng ngoài cho tới khi breakout được xác nhận.'
    },
    finalDecisionNote: 'Approved with a WAIT adjustment.'
  };
}

describe('claude daily analysis provider', () => {
  it('uses a longer default timeout and accepts a valid env override', () => {
    expect(resolveClaudeTimeoutMs(undefined)).toBe(60_000);
    expect(resolveClaudeTimeoutMs('45_000')).toBe(60_000);
    expect(resolveClaudeTimeoutMs('45000')).toBe(45_000);
  });

  it('generates a structured analyst draft with a dedicated prompt and tool output', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        content: [
          {
            type: 'tool_use',
            name: 'record_daily_analysis_draft',
            input: makeAnalystDraft()
          }
        ]
      }
    });

    const provider = new ClaudeDailyAnalysisProvider({ post } as never, 'sonnet', 'test-key');

    await expect(provider.generateDailyAnalysisDraft(makeMarketData())).resolves.toEqual({
      provider: 'claude',
      model: expect.any(String),
      draftPlan: expect.objectContaining({
        status: 'WAIT',
        setupType: 'breakout'
      })
    });

    expect(post).toHaveBeenCalledTimes(1);
    const payload = post.mock.calls[0]?.[1];
    expect(payload).toEqual(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'record_daily_analysis_draft'
          })
        ]),
        tool_choice: {
          type: 'tool',
          name: 'record_daily_analysis_draft'
        }
      })
    );
    expect(payload.messages[0].content).toContain('Analyst');
    expect(payload.messages[0].content).toContain('market_data');
    expect(payload.messages[0].content).toContain('breakout-following');
    expect(payload.messages[0].content).toContain('WAIT and NO_TRADE');
    expect(payload.messages[0].content).toContain('risk/reward');
    expect(payload.messages[0].content).toContain('ATR');
    expect(payload.messages[0].content).toContain('JSON only');
    expect(payload.messages[0].content).toContain('"symbol":"BTCUSDT"');
    expect(payload.messages[0].content).not.toContain('\n  "symbol"');
  });

  it('generates a structured validator result with a dedicated prompt and tool output', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        content: [
          {
            type: 'tool_use',
            name: 'validate_daily_analysis_draft',
            input: makeValidatorResult()
          }
        ]
      }
    });

    const provider = new ClaudeDailyAnalysisProvider({ post } as never, 'sonnet', 'test-key');

    await expect(
      provider.validateDailyAnalysisDraft({
        marketData: makeMarketData(),
        draftPlan: makeAnalystDraft()
      })
    ).resolves.toEqual({
      provider: 'claude',
      model: expect.any(String),
      validatorResult: expect.objectContaining({
        validationResult: 'APPROVED_WITH_ADJUSTMENTS'
      })
    });

    expect(post).toHaveBeenCalledTimes(1);
    const payload = post.mock.calls[0]?.[1];
    expect(payload).toEqual(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'validate_daily_analysis_draft'
          })
        ]),
        tool_choice: {
          type: 'tool',
          name: 'validate_daily_analysis_draft'
        }
      })
    );
    expect(payload.messages[0].content).toContain('Validator');
    expect(payload.messages[0].content).toContain('draft_plan');
    expect(payload.messages[0].content).toContain('market_data');
    expect(payload.messages[0].content).toContain('breakout-following');
    expect(payload.messages[0].content).toContain('WAIT or NO_TRADE');
    expect(payload.messages[0].content).toContain('JSON only');
    expect(payload.messages[0].content).toContain('"symbol":"BTCUSDT"');
    expect(payload.messages[0].content).not.toContain('\n  "symbol"');
  });

  it('normalizes partial analyst tool output into the canonical draft schema', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        content: [
          {
            type: 'tool_use',
            name: 'record_daily_analysis_draft',
            input: {
              summary: 'Thi truong dang nen chat, uu tien cho xac nhan.',
              bias: 'Neutral',
              confidence: 38,
              status: 'WAIT',
              timeframeContext: {
                D1: 'D1 van bullish nhung chua but pha.',
                H4: 'H4 dang compressed va can xac nhan.'
              },
              marketState: {
                currentPrice: 68395.2,
                session: 'Asia',
                liquidityCondition: 'tight',
                marketRegime: 'compressed',
                majorNewsNearby: false,
                D1_swingHigh: 69310,
                D1_swingLow: 66611.66,
                D1_support: [67360.66, 66611.66],
                D1_resistance: [68698.7, 69310],
                H4_swingHigh: 68408.37,
                H4_swingLow: 68153,
                H4_support: [68273.34, 68153],
                H4_resistance: [68169.65, 68408.37]
              },
              setupType: 'breakout',
              noTradeZone: 'Tranh vao lenh khi H4 chua xac nhan.'
            }
          }
        ]
      }
    });

    const provider = new ClaudeDailyAnalysisProvider({ post } as never, 'sonnet', 'test-key');

    await expect(provider.generateDailyAnalysisDraft(makeMarketData())).resolves.toEqual({
      provider: 'claude',
      model: expect.any(String),
      draftPlan: expect.objectContaining({
        status: 'WAIT',
        timeframeContext: expect.objectContaining({
          biasFrame: 'D1',
          setupFrame: 'H4',
          entryRefinementFrame: 'none',
          higherTimeframeView: expect.stringContaining('D1'),
          setupTimeframeView: expect.stringContaining('H4')
        }),
        marketState: expect.objectContaining({
          trendCondition: 'compressed',
          volumeCondition: 'very_weak'
        }),
        primarySetup: expect.objectContaining({
          direction: 'none'
        }),
        secondarySetup: expect.objectContaining({
          direction: 'none'
        }),
        atrConsistencyCheck: expect.objectContaining({
          result: expect.any(String)
        }),
        logicConsistencyCheck: expect.objectContaining({
          result: expect.any(String)
        }),
        reasoning: expect.any(Array),
        finalAction: expect.any(String)
      })
    });
  });

});
