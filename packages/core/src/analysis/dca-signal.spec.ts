import { computeDcaScore, dcaZone, type DcaScoreParams } from './dca-signal';

function scoreParams(o: Partial<DcaScoreParams> = {}): DcaScoreParams {
  return {
    marketCap: 2_000_000_000,
    weekTrend: 'Up',
    wEma89Above: true,
    wEma200Above: true,
    utBotW1Bullish: true,
    ...o,
  };
}

describe('computeDcaScore', () => {
  it('scores a large-cap healthy-weekly coin near the top', () => {
    expect(computeDcaScore(scoreParams())).toBeGreaterThanOrEqual(85);
  });

  it('a micro-cap is never safe even with a great weekly trend', () => {
    const micro = computeDcaScore(scoreParams({ marketCap: 5_000_000, weekTrend: 'StrongUp' }));
    expect(micro).toBeLessThanOrEqual(50); // 0 cap + capped 50 weekly
  });

  it('a weekly downtrend large-cap scores lower than an uptrend one', () => {
    const down = computeDcaScore(scoreParams({ weekTrend: 'StrongDown', wEma89Above: false, wEma200Above: false, utBotW1Bullish: false }));
    const up = computeDcaScore(scoreParams());
    expect(down).toBeLessThan(up);
  });

  it('null market cap = 0 cap contribution', () => {
    expect(computeDcaScore(scoreParams({ marketCap: null }))).toBeLessThanOrEqual(50);
  });
});

describe('dcaZone', () => {
  it('CHOT when price reclaimed EMA34', () => {
    expect(dcaZone({ ema34Above: true, rsi: 80, low20Pct: 50 })).toBe('CHOT');
  });

  it('GOM when oversold near the 20d low and below EMA34', () => {
    expect(dcaZone({ ema34Above: false, rsi: 30, low20Pct: 4 })).toBe('GOM');
  });

  it('CHO when below EMA34 but not yet oversold/near low', () => {
    expect(dcaZone({ ema34Above: false, rsi: 45, low20Pct: 20 })).toBe('CHO');
  });
});
