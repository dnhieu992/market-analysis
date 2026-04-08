import { runDailyAnalysisHardChecks } from './daily-analysis-hard-checks';

describe('daily analysis hard checks', () => {
  it('rejects breakout longs whose TP1 is at or below the breakout level', () => {
    const result = runDailyAnalysisHardChecks({
      strategyType: 'breakout_following',
      minimumRr: 1.5,
      preferredBreakoutRr: 2,
      direction: 'long',
      breakoutLevel: 68653.38,
      entry: 68680,
      stopLoss: 68110.55,
      takeProfit1: 68650,
      atrSetupFrame: 912.08,
      volumeRatio: 1.02,
      higherTimeframeAligned: true,
      status: 'TRADE_READY',
      narrativeText: 'Plan is still breakout-focused.'
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain(
      'TP1 is at or below breakout level for a breakout long setup.'
    );
    expect(result.derivedStatus).toBe('NO_TRADE');
  });

  it('downgrades weak-volume timeframe-conflict plans to WAIT', () => {
    const result = runDailyAnalysisHardChecks({
      strategyType: 'breakout_following',
      minimumRr: 1.5,
      preferredBreakoutRr: 2,
      direction: 'long',
      breakoutLevel: 68653.38,
      entry: 68680,
      stopLoss: 68110.55,
      takeProfit1: 69900,
      atrSetupFrame: 912.08,
      volumeRatio: 0.2,
      higherTimeframeAligned: false,
      status: 'TRADE_READY',
      narrativeText: 'The setup is unclear and mixed.'
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Weak volume combined with timeframe conflict: should prefer WAIT or NO_TRADE.',
        'Narrative suggests caution or no-trade, but status is TRADE_READY.'
      ])
    );
    expect(result.derivedStatus).toBe('WAIT');
  });

  it('flags risk-reward and ATR issues for breakout setups', () => {
    const result = runDailyAnalysisHardChecks({
      strategyType: 'breakout_following',
      minimumRr: 1.5,
      preferredBreakoutRr: 2,
      direction: 'short',
      breakdownLevel: 68153,
      entry: 68100,
      stopLoss: 68600,
      takeProfit1: 67950,
      atrSetupFrame: 600,
      volumeRatio: 0.8,
      higherTimeframeAligned: true,
      status: 'TRADE_READY',
      narrativeText: 'Breakout is confirmed.'
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'RR too low: 0.30 < 1.5',
        'TP distance is too small relative to setup-frame ATR for a breakout setup.'
      ])
    );
    expect(result.derivedStatus).toBe('NO_TRADE');
  });

  it('keeps structurally broken mixed-failure plans at NO_TRADE even if caution signals are also present', () => {
    const result = runDailyAnalysisHardChecks({
      strategyType: 'breakout_following',
      minimumRr: 1.5,
      preferredBreakoutRr: 2,
      direction: 'long',
      breakoutLevel: 68653.38,
      entry: 68680,
      stopLoss: 68110.55,
      takeProfit1: 68650,
      atrSetupFrame: 912.08,
      volumeRatio: 0.2,
      higherTimeframeAligned: false,
      status: 'TRADE_READY',
      narrativeText: 'The setup is unclear and compressed.'
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        'TP1 is at or below breakout level for a breakout long setup.',
        'Weak volume combined with timeframe conflict: should prefer WAIT or NO_TRADE.',
        'Narrative suggests caution or no-trade, but status is TRADE_READY.'
      ])
    );
    expect(result.derivedStatus).toBe('NO_TRADE');
  });
});
