import { computeEntryScore, type EntryScoreParams } from './entry-score';

/** A baseline low-risk pullback-in-uptrend setup; override per test. */
function params(overrides: Partial<EntryScoreParams> = {}): EntryScoreParams {
  return {
    extPct: 2,
    ema200Above: true,
    d1Trend: 'Up',
    weekTrend: 'Up',
    rsi: 48,
    volMultiplier: 0.9,
    utBotW1Bullish: true,
    utBotD1Bullish: true,
    utBotH4Bullish: true,
    rrRatio: 3,
    ...overrides,
  };
}

describe('computeEntryScore', () => {
  it('scores a textbook low-risk pullback near the top of the range', () => {
    const { entryScore, gatedOut } = computeEntryScore(params());
    expect(gatedOut).toBe(false);
    expect(entryScore).toBeGreaterThanOrEqual(90); // 30+20+15+25+10
  });

  it('gates out a downtrend regardless of other factors', () => {
    const res = computeEntryScore(params({ d1Trend: 'StrongDown' }));
    expect(res.gatedOut).toBe(true);
    expect(res.entryScore).toBe(0);
  });

  it('gates out when price is below EMA200', () => {
    expect(computeEntryScore(params({ ema200Above: false })).entryScore).toBe(0);
  });

  it('gates out an over-extended chase (extPct ≥ 18%)', () => {
    expect(computeEntryScore(params({ extPct: 22 })).entryScore).toBe(0);
  });

  it('an extended (but ungated) coin scores lower than a pullback', () => {
    const pullback = computeEntryScore(params({ extPct: 2 })).entryScore;
    const extended = computeEntryScore(params({ extPct: 12 })).entryScore;
    expect(extended).toBeLessThan(pullback);
  });

  it('penalises overbought RSI and missing R:R', () => {
    const overbought = computeEntryScore(params({ rsi: 78 })).entryScore;
    const noOrder = computeEntryScore(params({ rrRatio: null })).entryScore;
    const ideal = computeEntryScore(params()).entryScore;
    expect(overbought).toBeLessThan(ideal);
    expect(noOrder).toBeLessThan(ideal);
  });
});
