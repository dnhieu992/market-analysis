import {
  evaluateAddOn,
  pullbackEnabledFor,
  distPctFromLine,
  PULLBACK_KEYVALUE,
  PULLBACK_BAND_PCT,
  PULLBACK_MAX_ADDS,
} from '../src/modules/swing-trading/pullback-addon';

describe('pullbackEnabledFor', () => {
  it('is enabled only at the gated keyValue (4)', () => {
    expect(pullbackEnabledFor(PULLBACK_KEYVALUE)).toBe(true);
    expect(pullbackEnabledFor(4)).toBe(true);
    expect(pullbackEnabledFor(1)).toBe(false);
    expect(pullbackEnabledFor(2)).toBe(false);
    expect(pullbackEnabledFor(3)).toBe(false);
  });
});

describe('distPctFromLine', () => {
  it('returns the absolute fractional distance', () => {
    expect(distPctFromLine(101, 100)).toBeCloseTo(0.01);
    expect(distPctFromLine(99, 100)).toBeCloseTo(0.01);
  });
  it('guards against a zero line', () => {
    expect(distPctFromLine(100, 0)).toBe(Infinity);
  });
});

describe('evaluateAddOn', () => {
  const base = { addsThisTrend: 0, armed: false, line: 100 };

  it('arms when price is more than band% away from the line', () => {
    // 1.5% away (> 1% band)
    expect(evaluateAddOn({ ...base, close: 101.5 })).toBe('rearm');
    expect(evaluateAddOn({ ...base, close: 98.5 })).toBe('rearm');
  });

  it('does nothing inside the band when not armed', () => {
    expect(evaluateAddOn({ ...base, close: 100.5, armed: false })).toBe('none');
  });

  it('fires an add inside the band once armed', () => {
    expect(evaluateAddOn({ ...base, close: 100.5, armed: true })).toBe('add');
  });

  it('stops adding once maxAdds is reached (but still re-arms when away)', () => {
    const full = { ...base, armed: true, addsThisTrend: PULLBACK_MAX_ADDS };
    expect(evaluateAddOn({ ...full, close: 100.5 })).toBe('none');
    // price pushing away still re-arms even at max (harmless, matches backtest)
    expect(evaluateAddOn({ ...full, close: 102 })).toBe('rearm');
  });

  it('treats exactly band% as inside the band (not > band)', () => {
    const exact = 100 * (1 + PULLBACK_BAND_PCT / 100); // exactly 1% away
    expect(evaluateAddOn({ ...base, close: exact, armed: true })).toBe('add');
  });

  it('honours custom band/maxAdds overrides', () => {
    expect(evaluateAddOn({ ...base, close: 101.5, armed: true, bandPct: 2 })).toBe('add');
    expect(
      evaluateAddOn({ ...base, close: 100.5, armed: true, addsThisTrend: 1, maxAdds: 1 }),
    ).toBe('none');
  });
});
