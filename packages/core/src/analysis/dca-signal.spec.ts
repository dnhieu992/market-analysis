import { computeDcaScore, dcaZone, computeDcaTimingSignal, type DcaScoreParams, type DcaTimingSeries } from './dca-signal';

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

describe('computeDcaTimingSignal', () => {
  /** Build a series of `n` closes from a generator, with highs/lows ±0.5%. */
  function series(n: number, at: (i: number) => number): DcaTimingSeries {
    const closes = Array.from({ length: n }, (_, i) => at(i));
    return {
      closes,
      highs: closes.map((c) => c * 1.005),
      lows: closes.map((c) => c * 0.995),
    };
  }

  it('returns null when there is not enough D1 history', () => {
    const short = series(10, () => 100);
    expect(computeDcaTimingSignal(short, short, 1e9)).toBeNull();
  });

  it('flags GOM on a fresh selloff to the 20-day low (oversold large-cap)', () => {
    // Long uptrend then a sharp drop on the last bars → low RSI, sits at the 20d low.
    const d1 = series(220, (i) => (i < 200 ? 100 + i * 0.5 : 200 - (i - 199) * 6));
    const w1 = series(60, (i) => 100 + i); // healthy weekly uptrend
    const sig = computeDcaTimingSignal(d1, w1, 2_000_000_000)!;
    expect(sig.zone).toBe('GOM');
    expect(sig.ema34Above).toBe(false);
    expect(sig.rsi!).toBeLessThanOrEqual(35);
    expect(sig.score).toBeGreaterThanOrEqual(60); // large-cap (50) + weekly uptrend
  });

  it('flags CHOT when price is riding above EMA34', () => {
    const d1 = series(220, (i) => 100 + i); // steady uptrend, price > EMA34
    const w1 = series(60, (i) => 100 + i);
    const sig = computeDcaTimingSignal(d1, w1, 2_000_000_000)!;
    expect(sig.zone).toBe('CHOT');
    expect(sig.ema34Above).toBe(true);
  });
});
