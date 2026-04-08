import { dailyAnalysisValidatorResultSchema } from './daily-analysis-validator-result.schema';

describe('dailyAnalysisValidatorResultSchema', () => {
  it('parses the validator output contract', () => {
    const parsed = dailyAnalysisValidatorResultSchema.parse({
      validationResult: 'APPROVED_WITH_ADJUSTMENTS',
      summary: 'Plan hop ly nhung can gioi han volume.',
      majorIssues: [],
      minorIssues: ['Nen ghi ro volume xac nhan.'],
      checks: {
        timeframeConsistency: {
          result: 'PASS',
          details: 'D1 va H4 phu hop.'
        },
        breakoutLogic: {
          result: 'PASS',
          details: 'TP1 nam tren breakout trigger.'
        },
        riskReward: {
          result: 'PASS',
          details: 'RR dat nguong toi thieu.'
        },
        atrConsistency: {
          result: 'WARNING',
          details: 'ATR cao nen can nho gap.'
        },
        volumeConfirmation: {
          result: 'WARNING',
          details: 'Volume chua that su manh.'
        },
        narrativeVsAction: {
          result: 'PASS',
          details: 'Narrative khop voi action.'
        },
        structureQuality: {
          result: 'PASS',
          details: 'Cau truc du sach de xet.'
        }
      },
      correctedPlan: {
        summary: 'Uu tien cho breakout xac nhan.',
        bias: 'Bullish',
        confidence: 72,
        status: 'WAIT',
        setupType: 'breakout',
        primarySetup: {
          direction: 'long',
          trigger: 'Close tren breakout level.',
          entry: 'Retest sau breakout.',
          stopLoss: 'Duoi support.',
          takeProfit1: 'TP1',
          takeProfit2: 'TP2',
          riskReward: '2.0',
          invalidation: 'Mat support.'
        },
        finalAction: 'Cho breakout xac nhan roi moi vao lenh.'
      },
      finalDecisionNote: 'Can xac nhan them volume.'
    });

    expect(parsed.validationResult).toBe('APPROVED_WITH_ADJUSTMENTS');
    expect(parsed.correctedPlan.status).toBe('WAIT');
  });

  it('rejects invalid validation result values', () => {
    expect(() =>
      dailyAnalysisValidatorResultSchema.parse({
        validationResult: 'MAYBE',
        summary: 'test',
        majorIssues: [],
        minorIssues: [],
        checks: {
          timeframeConsistency: { result: 'PASS', details: 'x' },
          breakoutLogic: { result: 'PASS', details: 'x' },
          riskReward: { result: 'PASS', details: 'x' },
          atrConsistency: { result: 'PASS', details: 'x' },
          volumeConfirmation: { result: 'PASS', details: 'x' },
          narrativeVsAction: { result: 'PASS', details: 'x' },
          structureQuality: { result: 'PASS', details: 'x' }
        },
        correctedPlan: {
          summary: 'x',
          bias: 'Neutral',
          confidence: 10,
          status: 'WAIT',
          setupType: 'no-trade',
          primarySetup: {
            direction: 'none',
            trigger: 'x',
            entry: 'x',
            stopLoss: 'x',
            takeProfit1: 'x',
            takeProfit2: 'x',
            riskReward: '0',
            invalidation: 'x'
          },
          finalAction: 'x'
        },
        finalDecisionNote: 'x'
      })
    ).toThrow();
  });
});
