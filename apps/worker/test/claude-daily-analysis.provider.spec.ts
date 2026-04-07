import { ClaudeDailyAnalysisProvider } from '../src/modules/llm/claude-daily-analysis.provider';

describe('claude daily analysis provider', () => {
  const input = {
    symbol: 'BTCUSDT',
    date: new Date('2026-04-07T00:00:00.000Z'),
    d1: {
      trend: 'bullish' as const,
      s1: 81000,
      s2: 79000,
      r1: 85000,
      r2: 87000
    },
    h4: {
      trend: 'neutral' as const,
      s1: 82000,
      s2: 80500,
      r1: 84200,
      r2: 85500
    },
    h4Indicators: {
      ema20: 82800,
      ema50: 81950,
      ema200: 78100,
      rsi14: 61,
      macd: {
        macd: 145,
        signal: 110,
        histogram: 35
      },
      atr14: 920,
      volumeRatio: 1.45
    }
  };

  it('calls Anthropic messages API and returns the summary text', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        content: [
          {
            type: 'tool_use',
            name: 'record_daily_analysis_plan',
            input: {
              analysis: 'BTC dang giu xu huong tang trong ngay.',
              bias: 'bullish',
              confidence: 78,
              tradePlan: {
                entryZone: 'Canh mua 82,000-82,400.',
                stopLoss: 'Dung lo duoi 80,500.',
                takeProfit: 'Chot loi tai 84,200 va 85,500.',
                invalidation: 'Mat 80,500.'
              },
              scenarios: {
                bullishScenario: 'Giu 82,000 thi co the len 84,200.',
                bearishScenario: 'Mat 82,000 thi de lui ve 80,500.'
              },
              riskNote: 'Khong duoi gia.',
              timeHorizon: 'intraday to 1 day'
            }
          }
        ]
      }
    });

    const provider = new ClaudeDailyAnalysisProvider({ post } as never, 'sonnet', 'test-key');

    await expect(provider.generateDailyAnalysisPlan(input)).resolves.toEqual({
      provider: 'claude',
      model: 'claude-3-7-sonnet-latest',
      plan: expect.objectContaining({
        bias: 'bullish',
        confidence: 78
      })
    });

    expect(post).toHaveBeenCalledWith(
      '/messages',
      expect.objectContaining({
        model: expect.any(String),
        messages: expect.any(Array),
        tools: expect.any(Array),
        tool_choice: {
          type: 'tool',
          name: 'record_daily_analysis_plan'
        }
      })
    );

    const prompt = post.mock.calls[0]?.[1]?.messages?.[0]?.content as string;
    expect(prompt).toContain('D1 context');
    expect(prompt).toContain('H4 primary planning frame');
    expect(prompt).toContain('breakout-following trend');
    expect(prompt).toContain('EMA20');
    expect(prompt).toContain('RSI14');
    expect(prompt).toContain('counter-trend');
  });

  it('maps opus variant to the Opus model id', () => {
    const provider = new ClaudeDailyAnalysisProvider({ post: jest.fn() } as never, 'opus', 'test-key');

    expect(provider.getResolvedModel()).toContain('opus');
  });

  it('uses a raw model id without alias remapping', () => {
    const provider = new ClaudeDailyAnalysisProvider(
      { post: jest.fn() } as never,
      'claude-sonnet-4-20250514',
      'test-key'
    );

    expect(provider.getResolvedModel()).toBe('claude-sonnet-4-20250514');
  });

  it('throws when Claude returns no text content', async () => {
    const provider = new ClaudeDailyAnalysisProvider(
      { post: jest.fn().mockResolvedValue({ data: { content: [] } }) } as never,
      'sonnet',
      'test-key'
    );

    await expect(provider.generateDailyAnalysisPlan(input)).rejects.toThrow(
      'Claude daily analysis response was empty'
    );
  });

  it('parses JSON wrapped in markdown code fences', async () => {
    const provider = new ClaudeDailyAnalysisProvider(
      {
        post: jest.fn().mockResolvedValue({
          data: {
            content: [
              {
                type: 'text',
                text:
                  '```json\n{"analysis":"BTC dang tang.","bias":"bullish","confidence":78,"tradePlan":{"entryZone":"Canh mua breakout.","stopLoss":"Dung lo duoi H4 support.","takeProfit":"Chot loi tai khang cu tiep theo.","invalidation":"That bai giu breakout."},"scenarios":{"bullishScenario":"Breakout duoc giu vung.","bearishScenario":"Gia bi tu choi va quay lai range."},"riskNote":"Canh breakout gia.","timeHorizon":"intraday to 1 day"}\n```'
              }
            ]
          }
        })
      } as never,
      'sonnet',
      'test-key'
    );

    await expect(provider.generateDailyAnalysisPlan(input)).resolves.toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          bias: 'bullish'
        })
      })
    );
  });

  it('normalizes near-json output with trailing commas before parsing', async () => {
    const provider = new ClaudeDailyAnalysisProvider(
      {
        post: jest.fn().mockResolvedValue({
          data: {
            content: [
              {
                type: 'text',
                text:
                  '{"analysis":"BTC dang tang.","bias":"bullish","confidence":78,"tradePlan":{"entryZone":"Canh mua breakout.","stopLoss":"Dung lo duoi H4 support.","takeProfit":"Chot loi tai khang cu tiep theo.","invalidation":"That bai giu breakout.",},"scenarios":{"bullishScenario":"Breakout duoc giu vung.","bearishScenario":"Gia bi tu choi va quay lai range.",},"riskNote":"Canh breakout gia.","timeHorizon":"intraday to 1 day",}'
              }
            ]
          }
        })
      } as never,
      'sonnet',
      'test-key'
    );

    await expect(provider.generateDailyAnalysisPlan(input)).resolves.toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          bias: 'bullish'
        })
      })
    );
  });

  it('escapes raw newlines inside JSON strings before parsing', async () => {
    const provider = new ClaudeDailyAnalysisProvider(
      {
        post: jest.fn().mockResolvedValue({
          data: {
            content: [
              {
                type: 'text',
                text:
                  '{"analysis":"BTC dang tang.\nCho xac nhan breakout.","bias":"bullish","confidence":78,"tradePlan":{"entryZone":"Canh mua breakout.","stopLoss":"Dung lo duoi H4 support.","takeProfit":"Chot loi tai khang cu tiep theo.","invalidation":"That bai giu breakout."},"scenarios":{"bullishScenario":"Breakout duoc giu vung.","bearishScenario":"Gia bi tu choi va quay lai range."},"riskNote":"Canh breakout gia.","timeHorizon":"intraday to 1 day"}'
              }
            ]
          }
        })
      } as never,
      'sonnet',
      'test-key'
    );

    await expect(provider.generateDailyAnalysisPlan(input)).resolves.toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          analysis: expect.stringContaining('Cho xac nhan breakout')
        })
      })
    );
  });

  it('includes response details when Claude request fails', async () => {
    const provider = new ClaudeDailyAnalysisProvider(
      {
        post: jest.fn().mockRejectedValue({
          response: {
            status: 404,
            data: { error: { message: 'model not found' } }
          }
        })
      } as never,
      'sonnet',
      'test-key'
    );

    await expect(provider.generateDailyAnalysisPlan(input)).rejects.toThrow(
      'Claude daily analysis request failed with status 404'
    );
  });

  it('normalizes partially flattened tool input before validation', async () => {
    const provider = new ClaudeDailyAnalysisProvider(
      {
        post: jest.fn().mockResolvedValue({
          data: {
            content: [
              {
                type: 'tool_use',
                name: 'record_daily_analysis_plan',
                input: {
                  analysis: 'BTC dang giu xu huong tang.',
                  bias: 'bullish',
                  confidence: 78.6,
                  entryZone: 'Canh mua khi vuot 84,200.',
                  stopLoss: 'Dung lo duoi 82,000.',
                  takeProfit: 'Chot loi quanh 85,500.',
                  invalidation: 'Dong H4 duoi 82,000.',
                  bullishScenario: 'Breakout duoc xac nhan.',
                  bearishScenario: 'Pha vo that bai va quay lai range.',
                  risk_note: 'Khong FOMO.',
                  time_horizon: 'intraday to 1 day'
                }
              }
            ]
          }
        })
      } as never,
      'sonnet',
      'test-key'
    );

    await expect(provider.generateDailyAnalysisPlan(input)).resolves.toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          confidence: 79,
          tradePlan: expect.objectContaining({
            entryZone: 'Canh mua khi vuot 84,200.'
          }),
          scenarios: expect.objectContaining({
            bullishScenario: 'Breakout duoc xac nhan.'
          }),
          riskNote: 'Khong FOMO.',
          timeHorizon: 'intraday to 1 day'
        })
      })
    );
  });

  it('fills missing auxiliary fields locally without a repair request', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        content: [
          {
            type: 'tool_use',
            name: 'record_daily_analysis_plan',
            input: {
              analysis: 'BTC dang giu xu huong tang.',
              bias: 'bullish',
              confidence: 81,
              tradePlan: {
                entryZone: 'Canh mua khi dong H4 vuot 84,200.',
                stopLoss: 'Dung lo duoi 82,000.',
                takeProfit: 'Chot loi tai 85,500.',
                invalidation: 'Dong H4 duoi 82,000.'
              }
            }
          }
        ]
      }
    });

    const provider = new ClaudeDailyAnalysisProvider({ post } as never, 'sonnet', 'test-key');

    await expect(provider.generateDailyAnalysisPlan(input)).resolves.toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          scenarios: expect.objectContaining({
            bullishScenario: expect.stringContaining('84,200')
          }),
          riskNote: expect.stringContaining('H4'),
          timeHorizon: 'intraday to 1 day'
        })
      })
    );

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('derives a minimum trade plan locally when the tool input omits it', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        content: [
          {
            type: 'tool_use',
            name: 'record_daily_analysis_plan',
            input: {
              analysis: 'BTC dang giu xu huong tang.',
              bias: 'bullish',
              confidence: 81
            }
          }
        ]
      }
    });

    const provider = new ClaudeDailyAnalysisProvider({ post } as never, 'sonnet', 'test-key');

    await expect(provider.generateDailyAnalysisPlan(input)).resolves.toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          tradePlan: expect.objectContaining({
            entryZone: expect.stringContaining('84,200')
          }),
          scenarios: expect.objectContaining({
            bullishScenario: expect.stringContaining('84,200')
          }),
          riskNote: expect.stringContaining('H4'),
          timeHorizon: 'intraday to 1 day'
        })
      })
    );

    expect(post).toHaveBeenCalledTimes(1);
  });
});
