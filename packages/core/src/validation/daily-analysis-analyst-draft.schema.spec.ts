import { dailyAnalysisAnalystDraftSchema } from './daily-analysis-analyst-draft.schema';

describe('dailyAnalysisAnalystDraftSchema', () => {
  it('parses a draft plan returned by the analyst prompt', () => {
    const parsed = dailyAnalysisAnalystDraftSchema.parse({
      summary: 'He thong dang nen, uu tien cho breakout tang.',
      bias: 'Bullish',
      confidence: 78,
      status: 'TRADE_READY',
      timeframeContext: {
        biasFrame: 'D1',
        setupFrame: 'H4',
        entryRefinementFrame: 'none',
        higherTimeframeView: 'D1 van giu cau truc tang.',
        setupTimeframeView: 'H4 dang nen chat trong range hep.',
        alignment: 'aligned'
      },
      marketState: {
        trendCondition: 'compressed',
        volumeCondition: 'weak',
        volatilityCondition: 'high',
        keyObservation: 'Breakout can xac nhan volume.'
      },
      setupType: 'breakout',
      noTradeZone: 'Giua vung nen H4.',
      primarySetup: {
        direction: 'long',
        trigger: 'H4 close tren breakout level.',
        entry: 'Sau breakout retest.',
        stopLoss: 'Duoi support gan nhat.',
        takeProfit1: 'TP1 o resistance gan nhat.',
        takeProfit2: 'TP2 o resistance tiep theo.',
        riskReward: '2.1',
        invalidation: 'Dong H4 quay xuong duoi support.'
      },
      secondarySetup: {
        direction: 'none',
        trigger: 'Khong co',
        entry: 'Khong co',
        stopLoss: 'Khong co',
        takeProfit1: 'Khong co',
        takeProfit2: 'Khong co',
        riskReward: '0',
        invalidation: 'Khong co'
      },
      atrConsistencyCheck: {
        result: 'PASS',
        details: 'TP va SL phu hop ATR H4.'
      },
      logicConsistencyCheck: {
        result: 'PASS',
        details: 'Narrative va setup dong nhat.'
      },
      reasoning: ['D1 tang', 'H4 nen', 'Volume can xac nhan'],
      finalAction: 'Cho breakout xac nhan roi moi vao lenh.'
    });

    expect(parsed.bias).toBe('Bullish');
    expect(parsed.status).toBe('TRADE_READY');
  });

  it('rejects lowercase bias and legacy output fields', () => {
    expect(() =>
      dailyAnalysisAnalystDraftSchema.parse({
        summary: 'test',
        bias: 'bullish',
        confidence: 10,
        status: 'WAIT',
        timeframeContext: {
          biasFrame: 'D1',
          setupFrame: 'H4',
          entryRefinementFrame: 'none',
          higherTimeframeView: 'none',
          setupTimeframeView: 'none',
          alignment: 'neutral'
        },
        marketState: {
          trendCondition: 'ranging',
          volumeCondition: 'normal',
          volatilityCondition: 'normal',
          keyObservation: 'test'
        },
        setupType: 'breakout',
        noTradeZone: 'none',
        primarySetup: {
          direction: 'none',
          trigger: 'none',
          entry: 'none',
          stopLoss: 'none',
          takeProfit1: 'none',
          takeProfit2: 'none',
          riskReward: '0',
          invalidation: 'none'
        },
        secondarySetup: {
          direction: 'none',
          trigger: 'none',
          entry: 'none',
          stopLoss: 'none',
          takeProfit1: 'none',
          takeProfit2: 'none',
          riskReward: '0',
          invalidation: 'none'
        },
        atrConsistencyCheck: {
          result: 'WARNING',
          details: 'none'
        },
        logicConsistencyCheck: {
          result: 'WARNING',
          details: 'none'
        },
        reasoning: ['none'],
        finalAction: 'none',
        analysis: 'legacy',
        tradePlan: {
          entryZone: 'legacy',
          stopLoss: 'legacy',
          takeProfit: 'legacy',
          invalidation: 'legacy'
        }
      })
    ).toThrow();
  });
});
